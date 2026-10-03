import type { FetchLike, JudgeSpec } from "./types.js";

export interface JudgeRequest {
  rubric: string;
  input: string;
  output: string;
  expected?: string;
}

export interface JudgeVerdict {
  pass: boolean;
  reason: string;
}

export interface Judge {
  grade(req: JudgeRequest): Promise<JudgeVerdict>;
}

export class JudgeError extends Error {
  name = "JudgeError";
}

export const JUDGE_SYSTEM_PROMPT =
  "You are a strict evaluator of an AI assistant's response. Grade the RESPONSE against the RUBRIC only. " +
  'Reply with a single JSON object and nothing else: {"verdict": "pass" | "fail", "reason": "<one short sentence>"}';

const truncate = (s: string, n = 200) => (s.length > n ? `${s.slice(0, n)}...` : s);

export function buildMessages(req: JudgeRequest): { role: "system" | "user"; content: string }[] {
  const user = [
    `RUBRIC:\n${req.rubric}`,
    `INPUT:\n${req.input}`,
    `REFERENCE ANSWER (may be empty):\n${req.expected ?? ""}`,
    `RESPONSE:\n${req.output}`,
  ].join("\n\n");
  return [
    { role: "system", content: JUDGE_SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
}

/** Balanced `{...}` spans, left to right. Braces inside JSON strings do not count. */
export function extractJsonObjects(text: string): string[] {
  const spans: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "{") {
      i++;
      continue;
    }
    let depth = 0;
    let inString = false;
    let end = -1;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inString) {
        if (ch === "\\") j++;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        end = j;
        break;
      }
    }
    if (end === -1) {
      i++;
    } else {
      spans.push(text.slice(i, end + 1));
      i = end + 1;
    }
  }
  return spans;
}

export function parseVerdict(text: string): JudgeVerdict {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (!cleaned.includes("{")) throw new JudgeError(`judge reply has no JSON object: ${truncate(cleaned)}`);
  let sawObject = false;
  for (const span of extractJsonObjects(cleaned)) {
    let obj: unknown;
    try {
      obj = JSON.parse(span);
    } catch {
      continue;
    }
    if (typeof obj !== "object" || obj === null) continue;
    sawObject = true;
    if (!("verdict" in obj)) continue;
    const record = obj as Record<string, unknown>;
    const verdict = String(record.verdict ?? "").toLowerCase();
    if (verdict !== "pass" && verdict !== "fail") {
      throw new JudgeError(`judge verdict must be "pass" or "fail", got: ${truncate(span)}`);
    }
    return { pass: verdict === "pass", reason: String(record.reason ?? "") };
  }
  if (sawObject) throw new JudgeError(`judge reply has no "verdict" field: ${truncate(cleaned)}`);
  throw new JudgeError(`judge reply is not valid JSON: ${truncate(cleaned)}`);
}

export function createOpenAIJudge(spec: JudgeSpec, deps: { fetch: FetchLike; env: NodeJS.ProcessEnv }): Judge {
  const url = `${spec.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  return {
    async grade(req) {
      const headers: Record<string, string> = { "content-type": "application/json" };
      const apiKey = deps.env[spec.apiKeyEnv];
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;
      const body = JSON.stringify({ model: spec.model, temperature: spec.temperature, messages: buildMessages(req), ...spec.extraBody });
      let res: Response;
      try {
        res = await deps.fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(spec.timeoutMs) });
      } catch (e) {
        throw new JudgeError(`judge request to ${url} failed: ${(e as Error).message}`);
      }
      if (!res.ok) throw new JudgeError(`judge HTTP ${res.status}: ${truncate(await res.text())}`);
      const json = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
      const content = json.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new JudgeError("judge response is missing choices[0].message.content");
      return parseVerdict(content);
    },
  };
}
