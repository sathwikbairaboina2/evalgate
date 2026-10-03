import { describe, expect, it } from "vitest";
import { interpretKappa, parseLabelSet, renderCalibration, runCalibration } from "../src/calibrate.js";
import { ConfigError } from "../src/config.js";
import { fakeJudge } from "./helpers.js";

const yaml = `
name: mini
rubric: Answer must be correct.
items:
  - { id: p1, input: q1, output: good one, label: pass }
  - { id: p2, input: q2, output: good two, label: pass }
  - { id: f1, input: q3, output: bad one, label: fail }
  - { id: f2, input: q4, output: bad two, label: fail, rubric: Special rubric. }
`;

describe("parseLabelSet", () => {
  it("parses labels, falls back to the default rubric, and fills judge defaults", () => {
    const set = parseLabelSet(yaml, {});
    expect(set.name).toBe("mini");
    expect(set.items.map((i) => i.label)).toEqual([true, true, false, false]);
    expect(set.items[0].rubric).toBe("Answer must be correct.");
    expect(set.items[3].rubric).toBe("Special rubric.");
    expect(set.judge).toMatchObject({ baseUrl: "http://localhost:11434/v1", model: "qwen3.8:27b" });
  });
  it("applies judge env overrides", () => {
    expect(parseLabelSet(yaml, { EVALGATE_JUDGE_MODEL: "x" }).judge.model).toBe("x");
  });
  it("requires a rubric for every item", () => {
    expect(() => parseLabelSet(yaml.replace("rubric: Answer must be correct.\n", ""), {})).toThrow(/rubric/);
  });
  it("rejects bad labels and duplicate ids", () => {
    expect(() => parseLabelSet(yaml.replace("label: pass }", "label: maybe }"), {})).toThrow(ConfigError);
    expect(() => parseLabelSet(yaml.replace("id: p2", "id: p1"), {})).toThrow(/duplicate item id: p1/);
  });
});

describe("runCalibration", () => {
  it("gives kappa 1 for a perfect judge", async () => {
    const set = parseLabelSet(yaml, {});
    const judge = fakeJudge((req) => req.output.startsWith("good"));
    const r = await runCalibration(set, judge);
    expect(r).toMatchObject({ n: 4, scored: 4, errors: 0, kappa: 1, accuracy: 1, confusion: { tp: 2, fn: 0, fp: 0, tn: 2 } });
    expect(judge.calls[3].rubric).toBe("Special rubric.");
  });
  it("gives kappa 0 for an always-pass judge", async () => {
    const r = await runCalibration(parseLabelSet(yaml, {}), fakeJudge(() => true));
    expect(r.kappa).toBe(0);
    expect(r.accuracy).toBe(0.5);
  });
  it("excludes judge errors and counts them", async () => {
    const seen: string[] = [];
    const judge = fakeJudge((req) => (req.output === "bad two" ? new Error("unparseable") : req.output.startsWith("good")));
    const r = await runCalibration(parseLabelSet(yaml, {}), judge, (item) => seen.push(item.id));
    expect(r).toMatchObject({ n: 4, scored: 3, errors: 1 });
    expect(r.items[3]).toMatchObject({ id: "f2", judge: null, error: "unparseable" });
    expect(seen).toEqual(["p1", "p2", "f1", "f2"]);
  });
  it("measures duration with the injected clock", async () => {
    let t = 0;
    const r = await runCalibration(parseLabelSet(yaml, {}), fakeJudge(() => true), undefined, () => (t += 1000));
    expect(r.durationMs).toBe(1000);
  });
});

describe("interpretKappa", () => {
  it("uses Landis & Koch bands", () => {
    expect(interpretKappa(null)).toMatch(/n\/a/);
    expect(interpretKappa(-0.1)).toBe("worse than chance");
    expect(interpretKappa(0.1)).toBe("slight");
    expect(interpretKappa(0.3)).toBe("fair");
    expect(interpretKappa(0.5)).toBe("moderate");
    expect(interpretKappa(0.7)).toBe("substantial");
    expect(interpretKappa(0.9)).toBe("almost perfect");
  });
});

describe("renderCalibration", () => {
  it("shows kappa, the confusion matrix and disagreements", async () => {
    const r = await runCalibration(parseLabelSet(yaml, {}), fakeJudge(() => true));
    const md = renderCalibration(r);
    expect(md).toContain("### Judge calibration: mini");
    expect(md).toContain("`qwen3.8:27b`");
    expect(md).toContain("**Cohen's kappa: 0.000 (slight)**");
    expect(md).toContain("raw agreement 50.0%");
    expect(md).toContain("| **Human: pass** | 2 | 0 |");
    expect(md).toContain("| **Human: fail** | 2 | 0 |");
    expect(md).toContain("<details><summary>Disagreements (2)</summary>");
    expect(md).toContain("| `f1` | fail | pass |");
  });
});
