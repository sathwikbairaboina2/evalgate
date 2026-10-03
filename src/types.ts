export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type Scorer =
  | { type: "exact"; value: string; caseSensitive: boolean }
  | { type: "contains"; value: string[]; caseSensitive: boolean }
  | { type: "not-contains"; value: string[]; caseSensitive: boolean }
  | { type: "regex"; pattern: string; flags: string }
  | { type: "json-schema"; schema: Record<string, unknown> }
  | { type: "llm-judge"; rubric: string };

export type DeterministicScorer = Exclude<Scorer, { type: "llm-judge" }>;

export interface Case {
  id: string;
  input: string;
  expected?: string;
  critical: boolean;
  scorers: Scorer[];
}

export interface CommandTargetSpec {
  type: "command";
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
  timeoutMs: number;
}

export interface HttpTargetSpec {
  type: "http";
  url: string;
  headers: Record<string, string>;
  inputField: string;
  outputPath?: string;
  timeoutMs: number;
}

export type TargetSpec = CommandTargetSpec | HttpTargetSpec;

export interface JudgeSpec {
  baseUrl: string;
  model: string;
  apiKeyEnv: string;
  temperature: number;
  timeoutMs: number;
  extraBody?: Record<string, unknown>;
}

export interface GateSpec {
  minDelta: number;
  alpha: number;
  caseThreshold: number;
  permutations: number;
  seed: number;
}

export interface Suite {
  name: string;
  /** Absolute directory of the suite file; default workdir for command targets. */
  dir: string;
  target: TargetSpec;
  judge?: JudgeSpec;
  gate: GateSpec;
  repeats: number;
  concurrency: number;
  cases: Case[];
}

export interface ScorerResult {
  type: Scorer["type"];
  score: number;
  pass: boolean;
  reason: string;
  /** True when the scorer could not produce a verdict (e.g. judge failure). */
  error?: boolean;
}

export interface RepeatResult {
  output: string | null;
  latencyMs: number;
  score: number | null;
  pass: boolean;
  scorers: ScorerResult[];
  error?: string;
}

export interface CaseResult {
  id: string;
  critical: boolean;
  input: string;
  /** Mean over repeats; null if any repeat errored. */
  score: number | null;
  passRate: number;
  repeats: RepeatResult[];
  error?: string;
}

export interface RunSummary {
  cases: number;
  scored: number;
  errored: number;
  passing: number;
  meanScore: number;
}

export interface RunResult {
  schemaVersion: 1;
  suite: string;
  gate: GateSpec;
  startedAt: string;
  finishedAt: string;
  cases: CaseResult[];
  summary: RunSummary;
}
