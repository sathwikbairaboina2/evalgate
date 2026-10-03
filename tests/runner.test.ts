import { describe, expect, it } from "vitest";
import { mapLimit, runSuite, summarize } from "../src/runner.js";
import type { Target } from "../src/targets.js";
import type { Case, Scorer, Suite } from "../src/types.js";
import { fakeJudge } from "./helpers.js";

const gate = { minDelta: 0.02, alpha: 0.1, caseThreshold: 0.5, permutations: 1000, seed: 1 };
const contains = (v: string): Scorer => ({ type: "contains", value: [v], caseSensitive: false });
const c = (id: string, scorers: Scorer[], critical = false): Case => ({ id, input: id, critical, scorers });
const suite = (cases: Case[], over: Partial<Suite> = {}): Suite => ({
  name: "t",
  dir: ".",
  target: { type: "command", command: "x", args: [], env: {}, timeoutMs: 1000 },
  gate,
  repeats: 1,
  concurrency: 2,
  cases,
  ...over,
});
const mapTarget = (outputs: Record<string, string>): Target => async (input) => ({ output: outputs[input] ?? "", latencyMs: 1 });

describe("runSuite", () => {
  it("scores each case and summarizes", async () => {
    const r = await runSuite(suite([c("a", [contains("yes")]), c("b", [contains("yes")])]), { target: mapTarget({ a: "yes", b: "no" }) });
    expect(r.schemaVersion).toBe(1);
    expect(r.suite).toBe("t");
    expect(r.gate).toEqual(gate);
    expect(r.cases.map((x) => [x.id, x.score, x.passRate])).toEqual([["a", 1, 1], ["b", 0, 0]]);
    expect(r.summary).toEqual({ cases: 2, scored: 2, errored: 0, passing: 1, meanScore: 0.5 });
    expect(r.cases[0].repeats[0]).toMatchObject({ output: "yes", score: 1, pass: true });
  });

  it("averages scorers within a repeat; a repeat passes only if all scorers pass", async () => {
    const r = await runSuite(suite([c("a", [contains("yes"), contains("nope")])]), { target: mapTarget({ a: "yes" }) });
    expect(r.cases[0]).toMatchObject({ score: 0.5, passRate: 0 });
  });

  it("averages repeats", async () => {
    let n = 0;
    const target: Target = async () => ({ output: n++ % 2 === 0 ? "yes" : "no", latencyMs: 1 });
    const r = await runSuite(suite([c("a", [contains("yes")])], { repeats: 2 }), { target });
    expect(r.cases[0]).toMatchObject({ score: 0.5, passRate: 0.5 });
    expect(r.cases[0].repeats).toHaveLength(2);
  });

  it("marks target failures as errors, not zeros", async () => {
    const target: Target = async (input) => {
      if (input === "bad") throw new Error("boom");
      return { output: "yes", latencyMs: 1 };
    };
    const r = await runSuite(suite([c("ok", [contains("yes")]), c("bad", [contains("yes")])]), { target });
    const bad = r.cases.find((x) => x.id === "bad")!;
    expect(bad.score).toBeNull();
    expect(bad.error).toMatch(/target: boom/);
    expect(r.summary).toEqual({ cases: 2, scored: 1, errored: 1, passing: 1, meanScore: 1 });
  });

  it("uses the judge for llm-judge scorers and turns judge failures into errors", async () => {
    const judge = fakeJudge((req) => (req.output === "explode" ? new Error("judge HTTP 500") : req.output === "good"));
    const judged = (id: string) => c(id, [{ type: "llm-judge", rubric: "be good" }]);
    const r = await runSuite(suite([judged("g"), judged("b"), judged("x")]), {
      target: mapTarget({ g: "good", b: "bad", x: "explode" }),
      judge,
    });
    expect(r.cases.map((x) => x.score)).toEqual([1, 0, null]);
    expect(r.cases[2].error).toMatch(/llm-judge: judge HTTP 500/);
    expect(judge.calls[0]).toMatchObject({ rubric: "be good", input: "g", output: "good" });
  });

  it("errors llm-judge scorers when no judge is configured", async () => {
    const r = await runSuite(suite([c("a", [{ type: "llm-judge", rubric: "r" }])]), { target: mapTarget({ a: "x" }) });
    expect(r.cases[0].error).toMatch(/no judge configured/);
  });

  it("keeps case order under concurrency and reports each case", async () => {
    const seen: string[] = [];
    const target: Target = async (input) => {
      await new Promise((res) => setTimeout(res, input === "a" ? 30 : 1));
      return { output: "yes", latencyMs: 1 };
    };
    const r = await runSuite(suite([c("a", [contains("yes")]), c("b", [contains("yes")])]), { target, onCase: (x) => seen.push(x.id) });
    expect(r.cases.map((x) => x.id)).toEqual(["a", "b"]);
    expect(seen.sort()).toEqual(["a", "b"]);
  });
});

describe("helpers", () => {
  it("mapLimit keeps order and respects the limit", async () => {
    let active = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5], 2, async (x) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return x * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50]);
    expect(peak).toBe(2);
  });
  it("summarize handles empty input", () => {
    expect(summarize([])).toEqual({ cases: 0, scored: 0, errored: 0, passing: 0, meanScore: 0 });
  });
});
