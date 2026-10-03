export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Small, fast, seedable PRNG so permutation p-values are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PermutationOptions {
  permutations: number;
  seed: number;
}

const EXACT_LIMIT = 16;
const EPS = 1e-12;

/**
 * One-sided paired sign-flip permutation test. H1: mean(diffs) < 0 (head worse).
 * Exact enumeration for n <= 16, seeded Monte Carlo above.
 */
export function pairedPermutationPValue(diffs: readonly number[], opts: PermutationOptions): number {
  const n = diffs.length;
  if (n === 0 || diffs.every((d) => d === 0)) return 1;
  const observed = diffs.reduce((a, b) => a + b, 0);
  if (n <= EXACT_LIMIT) {
    const total = 2 ** n;
    let atOrBelow = 0;
    for (let mask = 0; mask < total; mask++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += mask & (1 << i) ? -diffs[i] : diffs[i];
      if (s <= observed + EPS) atOrBelow++;
    }
    return atOrBelow / total;
  }
  const rand = mulberry32(opts.seed);
  let atOrBelow = 0;
  for (let p = 0; p < opts.permutations; p++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += rand() < 0.5 ? -diffs[i] : diffs[i];
    if (s <= observed + EPS) atOrBelow++;
  }
  return (atOrBelow + 1) / (opts.permutations + 1);
}

export interface Confusion {
  tp: number; // human pass, judge pass
  fn: number; // human pass, judge fail
  fp: number; // human fail, judge pass
  tn: number; // human fail, judge fail
}

export function confusion(pairs: readonly { human: boolean; judge: boolean }[]): Confusion {
  const c: Confusion = { tp: 0, fn: 0, fp: 0, tn: 0 };
  for (const { human, judge } of pairs) {
    if (human && judge) c.tp++;
    else if (human) c.fn++;
    else if (judge) c.fp++;
    else c.tn++;
  }
  return c;
}

/** Binary Cohen's kappa. null when undefined (no items, or expected agreement = 1). */
export function cohenKappa(c: Confusion): number | null {
  const n = c.tp + c.fn + c.fp + c.tn;
  if (n === 0) return null;
  const po = (c.tp + c.tn) / n;
  const pYes = ((c.tp + c.fn) / n) * ((c.tp + c.fp) / n);
  const pNo = ((c.fp + c.tn) / n) * ((c.fn + c.tn) / n);
  const pe = pYes + pNo;
  if (pe === 1) return null;
  return (po - pe) / (1 - pe);
}

export function formatP(p: number): string {
  return p < 0.0001 ? "<0.0001" : p.toFixed(4);
}
