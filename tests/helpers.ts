import type { Judge, JudgeRequest } from "../src/judge.js";
import { summarize } from "../src/runner.js";
import type { CaseResult, GateSpec, RunResult } from "../src/types.js";

export function fakeJudge(decide: (req: JudgeRequest) => boolean | Error): Judge & { calls: JudgeRequest[] } {
  const calls: JudgeRequest[] = [];
  return {
    calls,
    async grade(req) {
      calls.push(req);
      const d = decide(req);
      if (d instanceof Error) throw d;
      return { pass: d, reason: d ? "looks right" : "looks wrong" };
    },
  };
}

export const GATE: GateSpec = { minDelta: 0.02, alpha: 0.1, caseThreshold: 0.5, permutations: 10000, seed: 42 };

/** Build a RunResult from [id, score|null, critical?] tuples. score null = errored case. */
export function makeRun(cases: Array<[id: string, score: number | null, critical?: boolean]>, suite = "s"): RunResult {
  const cs: CaseResult[] = cases.map(([id, score, critical = false]) => ({
    id,
    critical,
    input: id,
    score,
    passRate: score === 1 ? 1 : 0,
    repeats: [],
    ...(score === null ? { error: "target: boom" } : {}),
  }));
  return { schemaVersion: 1, suite, gate: GATE, startedAt: "", finishedAt: "", cases: cs, summary: summarize(cs) };
}
