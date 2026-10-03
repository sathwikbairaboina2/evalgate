import type { Judge } from "./judge.js";
import { scoreDeterministic } from "./scorers.js";
import type { Case, ScorerResult } from "./types.js";

export async function scoreOutput(output: string, c: Case, judge: Judge | undefined): Promise<ScorerResult[]> {
  const results: ScorerResult[] = [];
  for (const s of c.scorers) {
    if (s.type !== "llm-judge") {
      results.push(scoreDeterministic(output, s));
      continue;
    }
    if (!judge) {
      results.push({ type: s.type, score: 0, pass: false, reason: "no judge configured", error: true });
      continue;
    }
    try {
      const v = await judge.grade({ rubric: s.rubric, input: c.input, output, expected: c.expected });
      results.push({ type: s.type, score: v.pass ? 1 : 0, pass: v.pass, reason: v.reason });
    } catch (e) {
      results.push({ type: s.type, score: 0, pass: false, reason: (e as Error).message, error: true });
    }
  }
  return results;
}
