import { describe, expect, it } from "vitest";
import { compareRuns } from "../src/compare.js";
import { COMMENT_MARKER, fmtSigned, renderComment } from "../src/report.js";
import { makeRun } from "./helpers.js";

const ten = (overrides: Record<string, number | null> = {}) =>
  makeRun(Array.from({ length: 10 }, (_, i) => {
    const id = `c${i + 1}`;
    return [id, id in overrides ? overrides[id] : 1, id === "c1"] as [string, number | null, boolean];
  }), "toy");

describe("fmtSigned", () => {
  it("signs non-zero values and never prints -0", () => {
    expect(fmtSigned(0.05, 3)).toBe("+0.050");
    expect(fmtSigned(-0.5, 3)).toBe("-0.500");
    expect(fmtSigned(0, 3)).toBe("0.000");
    expect(fmtSigned(-0.00001, 3)).toBe("0.000");
  });
});

describe("renderComment", () => {
  it("renders a PASS comment for identical runs", () => {
    const md = renderComment(compareRuns(ten(), ten()));
    expect(md.startsWith(COMMENT_MARKER)).toBe(true);
    expect(md).toContain("### Evalgate: PASS");
    expect(md).toContain("| Mean score | 1.000 | 1.000 | 0.000 |");
    expect(md).toContain("| Cases passing | 10/10 | 10/10 | 0 |");
    expect(md).toContain("No case changed status.");
    expect(md).toContain("<details><summary>Unchanged cases (10)</summary>");
    expect(md).not.toContain("-0.000");
  });

  it("renders a FAIL comment with blocking reasons and changed cases", () => {
    const md = renderComment(compareRuns(ten(), ten({ c1: 0, c2: 0, c3: 0, c4: 0, c5: 0 })));
    expect(md).toContain("### Evalgate: FAIL");
    expect(md).toContain("`toy`");
    expect(md).toContain("| Mean score | 1.000 | 0.500 | -0.500 |");
    expect(md).toContain("| Cases passing | 10/10 | 5/10 | -5 |");
    expect(md).toContain("p = 0.0313");
    expect(md).toContain("**Blocking**");
    expect(md).toContain("- critical case c1 regressed (1.00 -> 0.00)");
    expect(md).toContain("#### Changed cases (5)");
    expect(md).toContain("| `c1` *(critical)* | 1.00 | 0.00 | -1.00 | regressed |");
    expect(md).toContain("<details><summary>Unchanged cases (5)</summary>");
  });

  it("shows errors and escapes pipes in notes", () => {
    const head = ten({ c2: null });
    head.cases[1].error = "target: bad | thing\nhappened";
    const md = renderComment(compareRuns(ten(), head));
    expect(md).toContain("| `c2` | 1.00 | error | — | error: head: target: bad \\| thing happened |");
    expect(md).toContain("**Blocking**");
  });

  it("lists warnings", () => {
    const md = renderComment(compareRuns(ten(), ten({ c2: 0 })));
    expect(md).toContain("**Warnings**");
    expect(md).toMatch(/treated as noise/);
  });
});
