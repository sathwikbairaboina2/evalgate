import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { applyJudgeEnv, ConfigError, formatIssues, ID_RE, judgeSchema } from "./config.js";
import type { Judge } from "./judge.js";
import { cohenKappa, confusion, type Confusion } from "./stats.js";
import type { JudgeSpec } from "./types.js";

export interface LabelItem {
  id: string;
  input: string;
  output: string;
  expected?: string;
  rubric: string;
  /** true = human says pass */
  label: boolean;
}

export interface LabelSet {
  name: string;
  judge: JudgeSpec;
  items: LabelItem[];
}

export interface CalibrationItemResult {
  id: string;
  human: boolean;
  judge: boolean | null;
  reason: string;
  error?: string;
}

export interface CalibrationReport {
  name: string;
  model: string;
  n: number;
  scored: number;
  errors: number;
  confusion: Confusion;
  kappa: number | null;
  accuracy: number;
  durationMs: number;
  items: CalibrationItemResult[];
}

const labelSetSchema = z
  .object({
    name: z.string().min(1),
    judge: judgeSchema.optional(),
    rubric: z.string().min(1).optional(),
    items: z
      .array(
        z
          .object({
            id: z.string().regex(ID_RE),
            input: z.string(),
            output: z.string(),
            expected: z.string().optional(),
            rubric: z.string().min(1).optional(),
            label: z.enum(["pass", "fail"]),
          })
          .strict(),
      )
      .min(2),
  })
  .strict();

export function parseLabelSet(text: string, env: NodeJS.ProcessEnv = process.env): LabelSet {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (e) {
    throw new ConfigError(`invalid YAML: ${(e as Error).message}`);
  }
  const parsed = labelSetSchema.safeParse(raw);
  if (!parsed.success) throw new ConfigError(`invalid label set:\n${formatIssues(parsed.error.issues)}`);
  const s = parsed.data;
  const seen = new Set<string>();
  const items: LabelItem[] = s.items.map((item) => {
    if (seen.has(item.id)) throw new ConfigError(`duplicate item id: ${item.id}`);
    seen.add(item.id);
    const rubric = item.rubric ?? s.rubric;
    if (!rubric) throw new ConfigError(`item ${item.id}: no rubric (set a top-level rubric or one per item)`);
    return { id: item.id, input: item.input, output: item.output, expected: item.expected, rubric, label: item.label === "pass" };
  });
  return { name: s.name, judge: applyJudgeEnv(judgeSchema.parse(s.judge ?? {}), env), items };
}

export async function loadLabelSet(file: string, env: NodeJS.ProcessEnv = process.env): Promise<LabelSet> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (e) {
    throw new ConfigError(`cannot read label file ${file}: ${(e as Error).message}`);
  }
  return parseLabelSet(text, env);
}

export async function runCalibration(
  set: LabelSet,
  judge: Judge,
  onItem?: (r: CalibrationItemResult, index: number) => void,
  now: () => number = () => performance.now(),
): Promise<CalibrationReport> {
  const started = now();
  const items: CalibrationItemResult[] = [];
  // Sequential on purpose: the judge is often a single shared local model.
  for (const [i, item] of set.items.entries()) {
    let r: CalibrationItemResult;
    try {
      const v = await judge.grade({ rubric: item.rubric, input: item.input, output: item.output, expected: item.expected });
      r = { id: item.id, human: item.label, judge: v.pass, reason: v.reason };
    } catch (e) {
      r = { id: item.id, human: item.label, judge: null, reason: "", error: (e as Error).message };
    }
    items.push(r);
    onItem?.(r, i);
  }
  const scored = items.filter((r): r is CalibrationItemResult & { judge: boolean } => r.judge !== null);
  const matrix = confusion(scored.map((r) => ({ human: r.human, judge: r.judge })));
  return {
    name: set.name,
    model: set.judge.model,
    n: items.length,
    scored: scored.length,
    errors: items.length - scored.length,
    confusion: matrix,
    kappa: cohenKappa(matrix),
    accuracy: scored.length ? (matrix.tp + matrix.tn) / scored.length : 0,
    durationMs: now() - started,
    items,
  };
}

export function interpretKappa(k: number | null): string {
  if (k === null) return "n/a: only one class present";
  if (k < 0) return "worse than chance";
  if (k <= 0.2) return "slight";
  if (k <= 0.4) return "fair";
  if (k <= 0.6) return "moderate";
  if (k <= 0.8) return "substantial";
  return "almost perfect";
}

const verdict = (v: boolean | null) => (v === null ? "error" : v ? "pass" : "fail");
const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

export function renderCalibration(r: CalibrationReport): string {
  const c = r.confusion;
  const kappa = r.kappa === null ? "n/a" : r.kappa.toFixed(3);
  const lines = [
    `### Judge calibration: ${r.name}`,
    "",
    `Judge model: \`${r.model}\` · items: ${r.n} (scored ${r.scored}, judge errors ${r.errors}) · run time ${(r.durationMs / 1000).toFixed(1)} s`,
    "",
    `**Cohen's kappa: ${kappa} (${interpretKappa(r.kappa)})** · raw agreement ${(r.accuracy * 100).toFixed(1)}%`,
    "",
    "|  | Judge: pass | Judge: fail |",
    "| --- | ---: | ---: |",
    `| **Human: pass** | ${c.tp} | ${c.fn} |`,
    `| **Human: fail** | ${c.fp} | ${c.tn} |`,
  ];
  const disagreements = r.items.filter((i) => i.judge === null || i.judge !== i.human);
  if (disagreements.length) {
    lines.push(
      "",
      `<details><summary>Disagreements (${disagreements.length})</summary>`,
      "",
      "| Item | Human | Judge | Judge reason / error |",
      "| --- | --- | --- | --- |",
      ...disagreements.map((i) => `| \`${i.id}\` | ${verdict(i.human)} | ${verdict(i.judge)} | ${esc(i.error ?? i.reason)} |`),
      "",
      "</details>",
    );
  }
  lines.push("");
  return lines.join("\n");
}
