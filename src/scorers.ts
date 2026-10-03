import Ajv, { type ValidateFunction } from "ajv";
import type { DeterministicScorer, ScorerResult } from "./types.js";

const ajv = new Ajv({ allErrors: true, strict: false });
const compiled = new WeakMap<object, ValidateFunction>();

/** Compile (and cache) a JSON Schema. Throws if the schema itself is invalid. */
export function compileJsonSchema(schema: Record<string, unknown>): ValidateFunction {
  let validate = compiled.get(schema);
  if (!validate) {
    validate = ajv.compile(schema);
    compiled.set(schema, validate);
  }
  return validate;
}

/** Parse the whole output as JSON, falling back to the first ```json fenced block. */
export function parseJsonOutput(output: string): { ok: true; value: unknown } | { ok: false } {
  const candidates = [output.trim()];
  const fence = output.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidates.push(fence[1].trim());
  for (const candidate of candidates) {
    try {
      return { ok: true, value: JSON.parse(candidate) };
    } catch {
      // try the next candidate
    }
  }
  return { ok: false };
}

function result(type: ScorerResult["type"], pass: boolean, reason: string): ScorerResult {
  return { type, pass, score: pass ? 1 : 0, reason };
}

const norm = (s: string, caseSensitive: boolean) => (caseSensitive ? s : s.toLowerCase());
const quote = (xs: string[]) => xs.map((x) => `"${x}"`).join(", ");

export function scoreDeterministic(output: string, s: DeterministicScorer): ScorerResult {
  switch (s.type) {
    case "exact": {
      const pass = norm(output.trim(), s.caseSensitive) === norm(s.value.trim(), s.caseSensitive);
      return result(s.type, pass, pass ? "exact match" : `expected exactly "${s.value}"`);
    }
    case "contains": {
      const hay = norm(output, s.caseSensitive);
      const missing = s.value.filter((v) => !hay.includes(norm(v, s.caseSensitive)));
      return result(s.type, missing.length === 0, missing.length ? `missing: ${quote(missing)}` : "all substrings present");
    }
    case "not-contains": {
      const hay = norm(output, s.caseSensitive);
      const found = s.value.filter((v) => hay.includes(norm(v, s.caseSensitive)));
      return result(s.type, found.length === 0, found.length ? `must not contain: ${quote(found)}` : "no forbidden substrings");
    }
    case "regex": {
      const pass = new RegExp(s.pattern, s.flags).test(output);
      return result(s.type, pass, `${pass ? "matches" : "does not match"} /${s.pattern}/${s.flags}`);
    }
    case "json-schema": {
      const parsed = parseJsonOutput(output);
      if (!parsed.ok) return result(s.type, false, "output is not valid JSON");
      const validate = compileJsonSchema(s.schema);
      const pass = validate(parsed.value) as boolean;
      return result(s.type, pass, pass ? "matches schema" : ajv.errorsText(validate.errors));
    }
  }
}
