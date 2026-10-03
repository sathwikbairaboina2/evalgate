import type { Judge, JudgeRequest } from "../src/judge.js";

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
