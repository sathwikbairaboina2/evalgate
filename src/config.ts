import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { compileJsonSchema } from "./scorers.js";
import type { JudgeSpec, Suite } from "./types.js";

export class ConfigError extends Error {
  name = "ConfigError";
}

export const ID_RE = /^[A-Za-z0-9._-]+$/;

const stringList = z
  .union([z.string(), z.array(z.string()).min(1)])
  .transform((v) => (Array.isArray(v) ? v : [v]));

const scorerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("exact"), value: z.string(), caseSensitive: z.boolean().default(true) }).strict(),
  z.object({ type: z.literal("contains"), value: stringList, caseSensitive: z.boolean().default(false) }).strict(),
  z.object({ type: z.literal("not-contains"), value: stringList, caseSensitive: z.boolean().default(false) }).strict(),
  z.object({ type: z.literal("regex"), pattern: z.string(), flags: z.string().default("") }).strict(),
  z.object({ type: z.literal("json-schema"), schema: z.record(z.string(), z.unknown()) }).strict(),
  z.object({ type: z.literal("llm-judge"), rubric: z.string().min(1) }).strict(),
]);

const targetSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("command"),
      command: z.string().min(1),
      args: z.array(z.string()).default([]),
      cwd: z.string().optional(),
      env: z.record(z.string(), z.string()).default({}),
      timeoutMs: z.number().int().positive().default(30000),
    })
    .strict(),
  z
    .object({
      type: z.literal("http"),
      url: z.string().min(1),
      headers: z.record(z.string(), z.string()).default({}),
      inputField: z.string().min(1).default("input"),
      outputPath: z.string().optional(),
      timeoutMs: z.number().int().positive().default(30000),
    })
    .strict(),
]);

export const judgeSchema = z
  .object({
    baseUrl: z.string().min(1).default("http://localhost:11434/v1"),
    model: z.string().min(1).default("qwen3.8:27b"),
    apiKeyEnv: z.string().min(1).default("EVALGATE_JUDGE_API_KEY"),
    temperature: z.number().min(0).max(2).default(0),
    timeoutMs: z.number().int().positive().default(120000),
    extraBody: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const gateSchema = z
  .object({
    minDelta: z.number().min(0).max(1).default(0.02),
    alpha: z.number().gt(0).max(1).default(0.1),
    caseThreshold: z.number().gt(0).max(1).default(0.5),
    permutations: z.number().int().min(100).max(1_000_000).default(10000),
    seed: z.number().int().default(42),
  })
  .strict();

const caseSchema = z
  .object({
    id: z.string().regex(ID_RE, "id may only contain letters, digits, '.', '_' and '-'"),
    input: z.string(),
    expected: z.string().optional(),
    critical: z.boolean().default(false),
    scorers: z.array(scorerSchema).min(1),
  })
  .strict();

const suiteSchema = z
  .object({
    name: z.string().min(1),
    target: targetSchema,
    judge: judgeSchema.optional(),
    gate: z.preprocess((v) => v ?? {}, gateSchema),
    repeats: z.number().int().min(1).max(20).default(1),
    concurrency: z.number().int().min(1).max(32).default(4),
    cases: z.array(caseSchema).min(1),
  })
  .strict();

export function formatIssues(issues: readonly { path: readonly PropertyKey[]; message: string }[]): string {
  return issues.map((i) => `${i.path.length ? i.path.map(String).join(".") : "(root)"}: ${i.message}`).join("\n");
}

export function applyJudgeEnv(j: JudgeSpec, env: NodeJS.ProcessEnv): JudgeSpec {
  return { ...j, baseUrl: env.EVALGATE_JUDGE_BASE_URL || j.baseUrl, model: env.EVALGATE_JUDGE_MODEL || j.model };
}

export function parseSuite(text: string, dir: string, env: NodeJS.ProcessEnv = process.env): Suite {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (e) {
    throw new ConfigError(`invalid YAML: ${(e as Error).message}`);
  }
  const parsed = suiteSchema.safeParse(raw);
  if (!parsed.success) throw new ConfigError(`invalid suite:\n${formatIssues(parsed.error.issues)}`);
  const s = parsed.data;

  const seen = new Set<string>();
  for (const c of s.cases) {
    if (seen.has(c.id)) throw new ConfigError(`duplicate case id: ${c.id}`);
    seen.add(c.id);
    for (const scorer of c.scorers) {
      if (scorer.type === "regex") {
        try {
          new RegExp(scorer.pattern, scorer.flags);
        } catch (e) {
          throw new ConfigError(`case ${c.id}: invalid regex: ${(e as Error).message}`);
        }
      }
      if (scorer.type === "json-schema") {
        try {
          compileJsonSchema(scorer.schema);
        } catch (e) {
          throw new ConfigError(`case ${c.id}: invalid JSON schema: ${(e as Error).message}`);
        }
      }
    }
  }

  const needsJudge = s.cases.some((c) => c.scorers.some((x) => x.type === "llm-judge"));
  const judge = s.judge || needsJudge ? applyJudgeEnv(judgeSchema.parse(s.judge ?? {}), env) : undefined;
  return { ...s, dir, judge };
}

export async function loadSuite(file: string, env: NodeJS.ProcessEnv = process.env): Promise<Suite> {
  const abs = path.resolve(file);
  let text: string;
  try {
    text = await readFile(abs, "utf8");
  } catch (e) {
    throw new ConfigError(`cannot read suite file ${abs}: ${(e as Error).message}`);
  }
  return parseSuite(text, path.dirname(abs), env);
}
