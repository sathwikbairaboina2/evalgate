import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadLabelSet, renderCalibration, runCalibration } from "./calibrate.js";
import { compareRuns } from "./compare.js";
import { ConfigError, loadSuite } from "./config.js";
import { GitHubError, upsertComment } from "./github.js";
import { createOpenAIJudge } from "./judge.js";
import { renderComment } from "./report.js";
import { runSuite } from "./runner.js";
import { createTarget } from "./targets.js";
import type { FetchLike, GateSpec, RunResult } from "./types.js";

export interface Io {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  env: NodeJS.ProcessEnv;
  fetch: FetchLike;
  cwd: string;
}

class UsageError extends Error {
  name = "UsageError";
}

export const USAGE = `Usage:
  evalgate run <suite.yaml> [--out results.json] [--workdir dir] [--repeats n] [--target-url url]
  evalgate compare --base base.json --head head.json [--comment comment.md]
                   [--min-delta x] [--alpha x] [--case-threshold x]
  evalgate calibrate <labels.yaml> [--out report.md] [--json report.json] [--min-kappa x]
  evalgate comment --repo owner/name --pr N --body-file comment.md [--api-url url]   (token from GITHUB_TOKEN)

Exit codes: 0 ok, 1 regression (compare) or kappa below --min-kappa (calibrate), 2 usage/config error.
`;

export async function main(argv: string[], io: Io): Promise<number> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case "run":
        return await cmdRun(rest, io);
      case "compare":
        return await cmdCompare(rest, io);
      case "calibrate":
        return await cmdCalibrate(rest, io);
      case "comment":
        return await cmdComment(rest, io);
      case "help":
      case "--help":
      case "-h":
        io.stdout(USAGE);
        return 0;
      case undefined:
        io.stderr(USAGE);
        return 2;
      default:
        throw new UsageError(`unknown command "${command}"`);
    }
  } catch (e) {
    const err = e as Error & { code?: string };
    const isArgs = typeof err.code === "string" && err.code.startsWith("ERR_PARSE_ARGS");
    if (err instanceof GitHubError) {
      io.stderr(`evalgate: error: ${err.message}
`);
      return 2;
    }
    if (err instanceof UsageError || err instanceof ConfigError || isArgs) {
      io.stderr(`evalgate: error: ${err.message}\n`);
      if (!(err instanceof ConfigError)) io.stderr(USAGE);
      return 2;
    }
    throw e;
  }
}

const resolveFrom = (io: Io, p: string) => path.resolve(io.cwd, p);

async function writeOut(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text, "utf8");
}

function num(flag: string, v: string | undefined, min: number, max: number): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (v.trim() === "" || !Number.isFinite(n) || n < min || n > max) {
    throw new UsageError(`${flag} must be a number between ${min} and ${max}, got "${v}"`);
  }
  return n;
}

async function cmdRun(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { out: { type: "string" }, workdir: { type: "string" }, repeats: { type: "string" }, "target-url": { type: "string" } },
  });
  if (positionals.length !== 1) throw new UsageError("run takes exactly one suite file");
  const repeats = num("--repeats", values.repeats, 1, 20);
  if (repeats !== undefined && !Number.isInteger(repeats)) throw new UsageError("--repeats must be an integer");
  const suite = await loadSuite(resolveFrom(io, positionals[0]), io.env);
  const target = createTarget(suite.target, {
    fetch: io.fetch,
    env: io.env,
    workdir: values.workdir ? resolveFrom(io, values.workdir) : suite.dir,
    urlOverride: values["target-url"],
  });
  const judge = suite.judge ? createOpenAIJudge(suite.judge, { fetch: io.fetch, env: io.env }) : undefined;
  const result = await runSuite(repeats ? { ...suite, repeats } : suite, {
    target,
    judge,
    onCase: (c) => {
      const status = c.error ? "ERR " : c.passRate === 1 ? "pass" : "FAIL";
      io.stderr(`  ${status}  ${c.id}${c.score === null ? `  (${c.error})` : `  ${c.score.toFixed(2)}`}\n`);
    },
  });
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (values.out) await writeOut(resolveFrom(io, values.out), json);
  else io.stdout(json);
  const s = result.summary;
  io.stderr(`evalgate: ${result.suite}: mean ${s.meanScore.toFixed(3)}, ${s.passing}/${s.cases} passing, ${s.errored} errored\n`);
  return 0;
}

async function readRun(file: string): Promise<RunResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    throw new UsageError(`cannot read results file ${file}: ${(e as Error).message}`);
  }
  const r = raw as Partial<RunResult> | null;
  if (!r || r.schemaVersion !== 1 || !Array.isArray(r.cases) || !r.summary || !r.gate) {
    throw new UsageError(`${file} is not an evalgate results file (schemaVersion 1)`);
  }
  return r as RunResult;
}

async function cmdCompare(args: string[], io: Io): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      base: { type: "string" },
      head: { type: "string" },
      comment: { type: "string" },
      "min-delta": { type: "string" },
      alpha: { type: "string" },
      "case-threshold": { type: "string" },
    },
  });
  if (!values.base || !values.head) throw new UsageError("compare needs --base and --head");
  const override: Partial<GateSpec> = {};
  const minDelta = num("--min-delta", values["min-delta"], 0, 1);
  const alpha = num("--alpha", values.alpha, 1e-9, 1);
  const caseThreshold = num("--case-threshold", values["case-threshold"], 1e-9, 1);
  if (minDelta !== undefined) override.minDelta = minDelta;
  if (alpha !== undefined) override.alpha = alpha;
  if (caseThreshold !== undefined) override.caseThreshold = caseThreshold;
  const base = await readRun(resolveFrom(io, values.base));
  const head = await readRun(resolveFrom(io, values.head));
  const comparison = compareRuns(base, head, override);
  const markdown = renderComment(comparison);
  io.stdout(markdown);
  if (values.comment) await writeOut(resolveFrom(io, values.comment), markdown);
  io.stderr(comparison.regression ? `evalgate: regression: ${comparison.failures.join("; ")}\n` : "evalgate: no regression beyond threshold\n");
  return comparison.regression ? 1 : 0;
}

async function cmdCalibrate(args: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { out: { type: "string" }, json: { type: "string" }, "min-kappa": { type: "string" } },
  });
  if (positionals.length !== 1) throw new UsageError("calibrate takes exactly one labels file");
  const minKappa = num("--min-kappa", values["min-kappa"], -1, 1);
  const set = await loadLabelSet(resolveFrom(io, positionals[0]), io.env);
  const judge = createOpenAIJudge(set.judge, { fetch: io.fetch, env: io.env });
  const verdict = (v: boolean | null) => (v === null ? "error" : v ? "pass" : "fail");
  const report = await runCalibration(set, judge, (r, i) =>
    io.stderr(`  [${i + 1}/${set.items.length}] ${r.id}: human ${verdict(r.human)}, judge ${verdict(r.judge)}${r.error ? ` (${r.error})` : ""}\n`),
  );
  const markdown = renderCalibration(report);
  io.stdout(markdown);
  if (values.out) await writeOut(resolveFrom(io, values.out), markdown);
  if (values.json) await writeOut(resolveFrom(io, values.json), `${JSON.stringify(report, null, 2)}\n`);
  if (minKappa !== undefined && (report.kappa === null || report.kappa < minKappa)) {
    io.stderr(`evalgate: kappa ${report.kappa === null ? "n/a" : report.kappa.toFixed(3)} is below --min-kappa ${minKappa}\n`);
    return 1;
  }
  return 0;
}

async function cmdComment(args: string[], io: Io): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { repo: { type: "string" }, pr: { type: "string" }, "body-file": { type: "string" }, "api-url": { type: "string" } },
  });
  if (!values.repo || !values.pr || !values["body-file"]) throw new UsageError("comment needs --repo, --pr and --body-file");
  const token = io.env.GITHUB_TOKEN;
  if (!token) throw new UsageError("comment needs GITHUB_TOKEN in the environment");
  const pr = Number(values.pr);
  let body: string;
  try {
    body = await readFile(resolveFrom(io, values["body-file"]), "utf8");
  } catch (e) {
    throw new UsageError(`cannot read body file ${values["body-file"]}: ${(e as Error).message}`);
  }
  const r = await upsertComment({
    fetch: io.fetch,
    apiUrl: values["api-url"] ?? io.env.GITHUB_API_URL ?? "https://api.github.com",
    token,
    repo: values.repo,
    pr,
    body,
  });
  io.stderr(`evalgate: comment ${r.action}: ${r.url}
`);
  return 0;
}
