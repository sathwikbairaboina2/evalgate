import { formatP, mean, pairedPermutationPValue } from "./stats.js";
import type { GateSpec, RunResult, RunSummary } from "./types.js";

export type CaseStatus = "regressed" | "improved" | "unchanged" | "added" | "removed" | "error";

export interface CaseDelta {
  id: string;
  critical: boolean;
  base: number | null;
  head: number | null;
  delta: number | null;
  status: CaseStatus;
  note?: string;
}

export interface Comparison {
  suite: string;
  gate: GateSpec;
  base: RunSummary;
  head: RunSummary;
  /** Number of cases scored on both sides. */
  paired: number;
  /** Mean of (head - base) over paired cases. */
  delta: number;
  /** One-sided paired permutation p-value (H1: head worse). */
  pValue: number;
  regression: boolean;
  failures: string[];
  warnings: string[];
  cases: CaseDelta[];
}

const EPS = 1e-9;
const ORDER: CaseStatus[] = ["error", "regressed", "removed", "added", "improved", "unchanged"];

export function compareRuns(base: RunResult, head: RunResult, override: Partial<GateSpec> = {}): Comparison {
  const gate: GateSpec = { ...head.gate, ...override };
  const baseById = new Map(base.cases.map((c) => [c.id, c]));
  const headIds = new Set(head.cases.map((c) => c.id));
  const cases: CaseDelta[] = [];
  const diffs: number[] = [];

  for (const h of head.cases) {
    const b = baseById.get(h.id);
    if (h.score === null) {
      cases.push({ id: h.id, critical: h.critical, base: b?.score ?? null, head: null, delta: null, status: "error", note: `head: ${h.error ?? "error"}` });
    } else if (!b) {
      cases.push({ id: h.id, critical: h.critical, base: null, head: h.score, delta: null, status: "added" });
    } else if (b.score === null) {
      cases.push({ id: h.id, critical: h.critical, base: null, head: h.score, delta: null, status: "error", note: `base: ${b.error ?? "error"}` });
    } else {
      const d = h.score - b.score;
      diffs.push(d);
      const status: CaseStatus = d <= -gate.caseThreshold + EPS ? "regressed" : d >= gate.caseThreshold - EPS ? "improved" : "unchanged";
      cases.push({ id: h.id, critical: h.critical, base: b.score, head: h.score, delta: d, status });
    }
  }
  for (const b of base.cases) {
    if (!headIds.has(b.id)) cases.push({ id: b.id, critical: b.critical, base: b.score, head: null, delta: null, status: "removed" });
  }

  const delta = mean(diffs);
  const pValue = pairedPermutationPValue(diffs, gate);
  const failures: string[] = [];
  const warnings: string[] = [];

  const headErrored = head.cases.filter((c) => c.score === null).map((c) => c.id);
  if (headErrored.length) failures.push(`${headErrored.length} case(s) errored on head, so results are incomplete: ${headErrored.join(", ")}`);
  for (const c of cases) {
    if (c.critical && c.status === "regressed") failures.push(`critical case ${c.id} regressed (${c.base!.toFixed(2)} -> ${c.head!.toFixed(2)})`);
  }
  const dropped = diffs.length > 0 && delta < 0 && delta <= -gate.minDelta + EPS;
  if (dropped && pValue < gate.alpha) {
    failures.push(`mean score fell by ${(-delta).toFixed(3)} (p = ${formatP(pValue)} < alpha ${gate.alpha})`);
  } else if (dropped) {
    warnings.push(`mean score fell by ${(-delta).toFixed(3)}, but p = ${formatP(pValue)} >= alpha ${gate.alpha}: treated as noise`);
  }
  const removed = cases.filter((c) => c.status === "removed").length;
  if (removed) warnings.push(`${removed} case(s) present on base are missing on head`);
  const baseErrored = base.cases.filter((c) => c.score === null && headIds.has(c.id)).length;
  if (baseErrored) warnings.push(`${baseErrored} case(s) errored on base and were not compared`);
  if (diffs.length === 0) warnings.push("no case could be compared between base and head");

  cases.sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.id.localeCompare(b.id));
  return { suite: head.suite, gate, base: base.summary, head: head.summary, paired: diffs.length, delta, pValue, regression: failures.length > 0, failures, warnings, cases };
}
