import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parseLabelSet } from "../src/calibrate.js";
import { main, type Io } from "../src/cli.js";
import type { FetchLike } from "../src/types.js";

const suite = path.resolve("examples/toy-agent/evalgate.yaml");
const judgeSuite = path.resolve("examples/toy-agent/evalgate.judge.yaml");
const labels = path.resolve("examples/calibration/support-labels.yaml");
const noFetch: FetchLike = async () => {
  throw new Error("network disabled in tests");
};

function makeIo(env: NodeJS.ProcessEnv = {}, fetch: FetchLike = noFetch) {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    stdout: (s) => void out.push(s),
    stderr: (s) => void err.push(s),
    env: { ...process.env, TOY_AGENT_VARIANT: "baseline", ...env },
    fetch,
    cwd: process.cwd(),
  };
  return { io, out: () => out.join(""), err: () => err.join("") };
}

/** Fake OpenAI-compatible judge: verdict decided from the RESPONSE at the end of the user message. */
function judgeFetch(decide: (response: string) => boolean): FetchLike {
  return async (_url, init) => {
    const body = JSON.parse(String(init.body));
    const user: string = body.messages[1].content;
    const response = user.slice(user.lastIndexOf("RESPONSE:\n") + "RESPONSE:\n".length);
    const content = JSON.stringify({ verdict: decide(response) ? "pass" : "fail", reason: "fake" });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  };
}

let dir: string;
let base: string;
let head: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "evalgate-cli-"));
  base = path.join(dir, "base.json");
  head = path.join(dir, "head.json");
  expect(await main(["run", suite, "--out", base], makeIo().io)).toBe(0);
  expect(await main(["run", suite, "--out", head], makeIo({ TOY_AGENT_VARIANT: "regressed" }).io)).toBe(0);
});

describe("evalgate run", () => {
  it("writes a results file and prints a summary", async () => {
    const result = JSON.parse(await readFile(base, "utf8"));
    expect(result.schemaVersion).toBe(1);
    expect(result.summary).toMatchObject({ cases: 10, passing: 10, meanScore: 1 });
    const t = makeIo();
    expect(await main(["run", suite, "--out", path.join(dir, "again.json")], t.io)).toBe(0);
    expect(t.err()).toContain("toy-support-agent: mean 1.000, 10/10 passing, 0 errored");
  });

  it("prints JSON to stdout without --out", async () => {
    const t = makeIo();
    expect(await main(["run", suite], t.io)).toBe(0);
    expect(JSON.parse(t.out()).summary.cases).toBe(10);
  });

  it("runs an llm-judge suite through the injected fetch", async () => {
    const t = makeIo({}, judgeFetch(() => true));
    expect(await main(["run", judgeSuite], t.io)).toBe(0);
    expect(JSON.parse(t.out()).summary).toMatchObject({ cases: 3, passing: 3 });
  });

  it("supports --workdir (used for the base checkout)", async () => {
    const t = makeIo();
    expect(await main(["run", suite, "--workdir", path.resolve("examples/toy-agent")], t.io)).toBe(0);
    expect(await main(["run", suite, "--workdir", dir], makeIo().io)).toBe(0); // agent.mjs missing -> every case errors, run still exits 0
  });

  it("rejects bad --repeats", async () => {
    const t = makeIo();
    expect(await main(["run", suite, "--repeats", "0"], t.io)).toBe(2);
    expect(t.err()).toMatch(/--repeats/);
  });
});

describe("evalgate compare", () => {
  it("exits 1 on the regressed toy agent and writes the comment", async () => {
    const comment = path.join(dir, "comment.md");
    const t = makeIo();
    expect(await main(["compare", "--base", base, "--head", head, "--comment", comment], t.io)).toBe(1);
    const md = await readFile(comment, "utf8");
    expect(md).toBe(t.out());
    expect(md).toContain("### Evalgate: FAIL");
    expect(md).toContain("critical case refund-window regressed");
    expect(md).toContain("critical case injection-refusal regressed");
    expect(md).toContain("mean score fell by 0.500 (p = 0.0313 < alpha 0.1)");
    expect(t.err()).toMatch(/regression/);
  });

  it("exits 0 when nothing changed", async () => {
    expect(await main(["compare", "--base", base, "--head", base], makeIo().io)).toBe(0);
  });

  it("validates numeric flags and input files", async () => {
    const t = makeIo();
    expect(await main(["compare", "--base", base, "--head", head, "--min-delta", "abc"], t.io)).toBe(2);
    expect(t.err()).toMatch(/--min-delta/);
    const bogus = path.join(dir, "bogus.json");
    await writeFile(bogus, "{}");
    expect(await main(["compare", "--base", bogus, "--head", head], makeIo().io)).toBe(2);
    expect(await main(["compare", "--base", base], makeIo().io)).toBe(2);
  });
});

describe("evalgate calibrate", () => {
  it("reports kappa 1.000 for a judge that matches the labels and passes --min-kappa", async () => {
    const set = parseLabelSet(await readFile(labels, "utf8"), {});
    const truth = new Map(set.items.map((i) => [i.output, i.label]));
    const t = makeIo({}, judgeFetch((response) => truth.get(response) === true));
    const out = path.join(dir, "cal.md");
    const json = path.join(dir, "cal.json");
    expect(await main(["calibrate", labels, "--out", out, "--json", json, "--min-kappa", "0.9"], t.io)).toBe(0);
    expect(t.out()).toContain("**Cohen's kappa: 1.000 (almost perfect)**");
    expect(JSON.parse(await readFile(json, "utf8")).kappa).toBe(1);
    expect(await readFile(out, "utf8")).toBe(t.out());
  });

  it("exits 1 when kappa is below --min-kappa", async () => {
    const t = makeIo({}, judgeFetch(() => true));
    expect(await main(["calibrate", labels, "--min-kappa", "0.6"], t.io)).toBe(1);
    expect(t.err()).toMatch(/below --min-kappa 0.6/);
  });
});

describe("usage and errors", () => {
  it("prints help", async () => {
    const t = makeIo();
    expect(await main(["--help"], t.io)).toBe(0);
    expect(t.out()).toMatch(/^Usage:/);
  });
  it("exits 2 on unknown commands, unknown flags and bad suites", async () => {
    expect(await main(["frobnicate"], makeIo().io)).toBe(2);
    expect(await main(["run", suite, "--nope"], makeIo().io)).toBe(2);
    expect(await main([], makeIo().io)).toBe(2);
    const bad = path.join(dir, "bad.yaml");
    await writeFile(bad, "name: x\ncases: []\n");
    const t = makeIo();
    expect(await main(["run", bad], t.io)).toBe(2);
    expect(t.err()).toMatch(/^evalgate: error: invalid suite/);
  });
});
