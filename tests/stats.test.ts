import { describe, expect, it } from "vitest";
import { cohenKappa, confusion, formatP, mean, mulberry32, pairedPermutationPValue } from "../src/stats.js";

const opts = { permutations: 10000, seed: 42 };

describe("mean", () => {
  it("returns 0 for an empty list", () => expect(mean([])).toBe(0));
  it("averages numbers", () => expect(mean([1, 0, 0.5])).toBeCloseTo(0.5));
});

describe("mulberry32", () => {
  it("is deterministic and in [0, 1)", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe("pairedPermutationPValue (one-sided: head worse than base)", () => {
  it("is 1 with no pairs or all-zero diffs", () => {
    expect(pairedPermutationPValue([], opts)).toBe(1);
    expect(pairedPermutationPValue([0, 0, 0], opts)).toBe(1);
  });
  it("is exact for small n: three drops give 1/8", () => {
    expect(pairedPermutationPValue([-1, -1, -1], opts)).toBe(0.125);
  });
  it("five drops give 1/32", () => {
    expect(pairedPermutationPValue([-1, -1, -1, -1, -1], opts)).toBe(1 / 32);
  });
  it("zero diffs do not change the p-value", () => {
    expect(pairedPermutationPValue([-1, -1, -1, 0, 0], opts)).toBe(0.125);
  });
  it("balanced changes are not significant", () => {
    expect(pairedPermutationPValue([-1, 1], opts)).toBe(0.75);
  });
  it("improvements are never significant as regressions", () => {
    expect(pairedPermutationPValue([1, 1, 1], opts)).toBe(1);
  });
  it("uses seeded Monte Carlo above 16 pairs and is deterministic", () => {
    const diffs = Array.from({ length: 20 }, () => -1);
    const p = pairedPermutationPValue(diffs, opts);
    expect(p).toBeLessThan(0.001);
    expect(pairedPermutationPValue(diffs, opts)).toBe(p);
  });
});

describe("confusion + cohenKappa", () => {
  it("counts rows=human, cols=judge", () => {
    expect(
      confusion([
        { human: true, judge: true },
        { human: true, judge: false },
        { human: false, judge: true },
        { human: false, judge: false },
        { human: false, judge: false },
      ]),
    ).toEqual({ tp: 1, fn: 1, fp: 1, tn: 2 });
  });
  it("matches the textbook example (kappa 0.4)", () => {
    expect(cohenKappa({ tp: 20, fn: 5, fp: 10, tn: 15 })).toBeCloseTo(0.4, 10);
  });
  it("is 1 for perfect agreement and -1 for perfect disagreement", () => {
    expect(cohenKappa({ tp: 5, fn: 0, fp: 0, tn: 5 })).toBe(1);
    expect(cohenKappa({ tp: 0, fn: 5, fp: 5, tn: 0 })).toBe(-1);
  });
  it("is null when undefined (empty, or one class only)", () => {
    expect(cohenKappa({ tp: 0, fn: 0, fp: 0, tn: 0 })).toBeNull();
    expect(cohenKappa({ tp: 10, fn: 0, fp: 0, tn: 0 })).toBeNull();
  });
});

describe("formatP", () => {
  it("prints 4 decimals and a floor", () => {
    expect(formatP(1 / 32)).toBe("0.0313");
    expect(formatP(1)).toBe("1.0000");
    expect(formatP(0.00001)).toBe("<0.0001");
  });
});
