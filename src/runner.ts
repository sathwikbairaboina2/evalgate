import type { Judge } from "./judge.js";
import { scoreOutput } from "./scoring.js";
import { mean } from "./stats.js";
import type { Target } from "./targets.js";
import type { Case, CaseResult, RepeatResult, RunResult, RunSummary, Suite } from "./types.js";

export interface RunDeps {
  target: Target;
  judge?: Judge;
  onCase?: (r: CaseResult) => void;
  now?: () => Date;
}

export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function runRepeat(c: Case, deps: RunDeps): Promise<RepeatResult> {
  let output: string;
  let latencyMs: number;
  try {
    ({ output, latencyMs } = await deps.target(c.input));
  } catch (e) {
    return { output: null, latencyMs: 0, score: null, pass: false, scorers: [], error: `target: ${(e as Error).message}` };
  }
  const scorers = await scoreOutput(output, c, deps.judge);
  const failed = scorers.find((s) => s.error);
  if (failed) return { output, latencyMs, score: null, pass: false, scorers, error: `${failed.type}: ${failed.reason}` };
  return { output, latencyMs, score: mean(scorers.map((s) => s.score)), pass: scorers.every((s) => s.pass), scorers };
}

async function runCase(c: Case, repeats: number, deps: RunDeps): Promise<CaseResult> {
  const rs: RepeatResult[] = [];
  for (let i = 0; i < repeats; i++) rs.push(await runRepeat(c, deps));
  const errored = rs.find((r) => r.error);
  const result: CaseResult = {
    id: c.id,
    critical: c.critical,
    input: c.input,
    score: errored ? null : mean(rs.map((r) => r.score as number)),
    passRate: rs.filter((r) => r.pass).length / rs.length,
    repeats: rs,
    ...(errored ? { error: errored.error } : {}),
  };
  deps.onCase?.(result);
  return result;
}

export function summarize(cases: readonly CaseResult[]): RunSummary {
  const scored = cases.filter((c) => c.score !== null);
  return {
    cases: cases.length,
    scored: scored.length,
    errored: cases.length - scored.length,
    passing: scored.filter((c) => c.passRate === 1).length,
    meanScore: mean(scored.map((c) => c.score as number)),
  };
}

export async function runSuite(suite: Suite, deps: RunDeps): Promise<RunResult> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const cases = await mapLimit(suite.cases, suite.concurrency, (c) => runCase(c, suite.repeats, deps));
  return { schemaVersion: 1, suite: suite.name, gate: suite.gate, startedAt, finishedAt: now().toISOString(), cases, summary: summarize(cases) };
}
