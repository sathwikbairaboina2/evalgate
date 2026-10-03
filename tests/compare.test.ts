import { describe, expect, it } from "vitest";
import { compareRuns } from "../src/compare.js";
import { makeRun } from "./helpers.js";

const ten = (overrides: Record<string, number | null> = {}, critical: string[] = []) =>
  makeRun(Array.from({ length: 10 }, (_, i) => {
    const id = `c${i + 1}`;
    return [id, id in overrides ? overrides[id] : 1, critical.includes(id)] as [string, number | null, boolean];
  }));

describe("compareRuns", () => {
  it("passes identical runs with p = 1 and zero delta", () => {
    const c = compareRuns(ten(), ten());
    expect(c.regression).toBe(false);
    expect(c.delta).toBe(0);
    expect(c.pValue).toBe(1);
    expect(c.paired).toBe(10);
    expect(c.cases.every((x) => x.status === "unchanged")).toBe(true);
    expect(c.failures).toEqual([]);
  });

  it("fails a significant aggregate drop", () => {
    const head = ten({ c1: 0, c2: 0, c3: 0, c4: 0, c5: 0 });
    const c = compareRuns(ten(), head);
    expect(c.regression).toBe(true);
    expect(c.delta).toBeCloseTo(-0.5);
    expect(c.pValue).toBe(1 / 32);
    expect(c.failures).toContain("mean score fell by 0.500 (p = 0.0313 < alpha 0.1)");
    expect(c.cases.filter((x) => x.status === "regressed").map((x) => x.id)).toEqual(["c1", "c2", "c3", "c4", "c5"]);
  });

  it("treats a small non-critical drop as noise", () => {
    const c = compareRuns(ten(), ten({ c1: 0 }));
    expect(c.regression).toBe(false);
    expect(c.warnings.join("\n")).toMatch(/treated as noise/);
    expect(c.cases[0]).toMatchObject({ id: "c1", status: "regressed", base: 1, head: 0, delta: -1 });
  });

  it("fails any regression of a critical case", () => {
    const c = compareRuns(ten({}, ["c1"]), ten({ c1: 0 }, ["c1"]));
    expect(c.regression).toBe(true);
    expect(c.failures.join("\n")).toMatch(/critical case c1 regressed \(1\.00 -> 0\.00\)/);
  });

  it("fails closed when a case errored on head", () => {
    const c = compareRuns(ten(), ten({ c3: null }));
    expect(c.regression).toBe(true);
    expect(c.failures.join("\n")).toMatch(/1 case\(s\) errored on head.*c3/);
    expect(c.cases[0]).toMatchObject({ id: "c3", status: "error", head: null, note: "head: target: boom" });
    expect(c.paired).toBe(9);
  });

  it("warns, but passes, when a case errored on base", () => {
    const c = compareRuns(ten({ c3: null }), ten());
    expect(c.regression).toBe(false);
    expect(c.cases.find((x) => x.id === "c3")).toMatchObject({ status: "error", note: "base: target: boom" });
    expect(c.warnings.join("\n")).toMatch(/errored on base/);
  });

  it("handles added and removed cases", () => {
    const base = makeRun([["a", 1], ["gone", 1]]);
    const head = makeRun([["a", 1], ["new", 0]]);
    const c = compareRuns(base, head);
    expect(c.regression).toBe(false);
    expect(c.cases.map((x) => [x.id, x.status])).toEqual([["gone", "removed"], ["new", "added"], ["a", "unchanged"]]);
    expect(c.warnings.join("\n")).toMatch(/1 case\(s\) present on base are missing on head/);
    expect(c.paired).toBe(1);
  });

  it("warns when nothing can be compared", () => {
    const c = compareRuns(makeRun([["a", 1]]), makeRun([["b", 1]]));
    expect(c.regression).toBe(false);
    expect(c.warnings.join("\n")).toMatch(/no case could be compared/);
  });

  it("marks improvements", () => {
    const c = compareRuns(ten({ c1: 0 }), ten());
    expect(c.cases[0]).toMatchObject({ id: "c1", status: "improved", delta: 1 });
    expect(c.regression).toBe(false);
  });

  it("applies gate overrides", () => {
    const head = ten({ c1: 0, c2: 0, c3: 0, c4: 0, c5: 0 });
    const c = compareRuns(ten(), head, { alpha: 0.01 });
    expect(c.gate.alpha).toBe(0.01);
    expect(c.regression).toBe(false);
    expect(c.warnings.join("\n")).toMatch(/p = 0\.0313 >= alpha 0\.01/);
  });

  it("does not fail on a drop when minDelta is 0 and delta is 0", () => {
    expect(compareRuns(ten(), ten(), { minDelta: 0 }).regression).toBe(false);
  });
});
