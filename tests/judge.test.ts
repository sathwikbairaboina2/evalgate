import { describe, expect, it } from "vitest";
import { buildMessages, createOpenAIJudge, extractJsonObjects, JudgeError, parseVerdict } from "../src/judge.js";
import type { JudgeSpec } from "../src/types.js";

const spec: JudgeSpec = { baseUrl: "http://judge.test/v1/", model: "m", apiKeyEnv: "EVALGATE_JUDGE_API_KEY", temperature: 0, timeoutMs: 1000 };
const chat = (content: string) => ({ choices: [{ message: { content } }] });

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
  return { fetch, calls };
}

describe("parseVerdict", () => {
  it("parses a plain JSON verdict", () => {
    expect(parseVerdict('{"verdict":"pass","reason":"ok"}')).toEqual({ pass: true, reason: "ok" });
  });
  it("strips <think> blocks and surrounding prose", () => {
    const text = '<think>hmm {"verdict":"pass"}</think>\nSure! {"verdict": "fail", "reason": "wrong window"} done';
    expect(parseVerdict(text)).toEqual({ pass: false, reason: "wrong window" });
  });
  it("accepts uppercase verdicts", () => {
    expect(parseVerdict('{"verdict":"PASS"}').pass).toBe(true);
  });
  it("throws JudgeError on no JSON, bad JSON, or a missing verdict", () => {
    expect(() => parseVerdict("I think it passes")).toThrow(JudgeError);
    expect(() => parseVerdict("{verdict: pass}")).toThrow(JudgeError);
    expect(() => parseVerdict('{"reason":"x"}')).toThrow(/verdict/);
  });
  it("skips a leading brace group that is not a verdict", () => {
    expect(parseVerdict('Note {x}. {"verdict":"pass","reason":"ok"}').pass).toBe(true);
  });
  it("takes the first verdict when there are two objects", () => {
    expect(parseVerdict('{"verdict":"fail","reason":"a"} {"verdict":"pass","reason":"b"}')).toEqual({ pass: false, reason: "a" });
  });
  it("is not fooled by braces inside strings", () => {
    expect(parseVerdict('{"verdict":"pass","reason":"uses } and { in text"}')).toEqual({ pass: true, reason: "uses } and { in text" });
  });
  it("throws on an unbalanced object", () => {
    expect(() => parseVerdict('{"verdict": "pass"')).toThrow(JudgeError);
  });
  it("never passes an object without a verdict", () => {
    expect(() => parseVerdict('{"note":"no verdict here"}')).toThrow(JudgeError);
  });
});

describe("extractJsonObjects", () => {
  it("returns balanced spans in order", () => {
    expect(extractJsonObjects('a {"k":"}"} b {"z":{"y":1}}')).toEqual(['{"k":"}"}', '{"z":{"y":1}}']);
  });
  it("returns nothing for unbalanced text", () => {
    expect(extractJsonObjects('{"a": 1')).toEqual([]);
  });
});

describe("buildMessages", () => {
  it("puts rubric, input, reference and response in the user message, response last", () => {
    const [system, user] = buildMessages({ rubric: "R", input: "I", output: "O", expected: "E" });
    expect(system.role).toBe("system");
    expect(user.content).toContain("RUBRIC:\nR");
    expect(user.content).toContain("INPUT:\nI");
    expect(user.content).toContain("E");
    expect(user.content.endsWith("RESPONSE:\nO")).toBe(true);
  });
});

describe("createOpenAIJudge", () => {
  it("posts a chat completion and returns the verdict", async () => {
    const { fetch, calls } = fakeFetch(200, chat('{"verdict":"pass","reason":"fine"}'));
    const judge = createOpenAIJudge({ ...spec, extraBody: { reasoning_effort: "none" } }, { fetch, env: { EVALGATE_JUDGE_API_KEY: "k" } });
    await expect(judge.grade({ rubric: "R", input: "I", output: "O" })).resolves.toEqual({ pass: true, reason: "fine" });
    expect(calls[0].url).toBe("http://judge.test/v1/chat/completions");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer k");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({ model: "m", temperature: 0, reasoning_effort: "none" });
    expect(body.messages).toHaveLength(2);
  });
  it("sends no authorization header without a key", async () => {
    const { fetch, calls } = fakeFetch(200, chat('{"verdict":"fail"}'));
    await createOpenAIJudge(spec, { fetch, env: {} }).grade({ rubric: "R", input: "I", output: "O" });
    expect((calls[0].init.headers as Record<string, string>).authorization).toBeUndefined();
  });
  it("throws JudgeError on HTTP errors", async () => {
    const { fetch } = fakeFetch(500, "boom");
    await expect(createOpenAIJudge(spec, { fetch, env: {} }).grade({ rubric: "R", input: "I", output: "O" })).rejects.toThrow(/HTTP 500/);
  });
  it("throws JudgeError when content is missing", async () => {
    const { fetch } = fakeFetch(200, { choices: [] });
    await expect(createOpenAIJudge(spec, { fetch, env: {} }).grade({ rubric: "R", input: "I", output: "O" })).rejects.toThrow(JudgeError);
  });
  it("throws JudgeError when fetch itself fails", async () => {
    const fetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    await expect(createOpenAIJudge(spec, { fetch, env: {} }).grade({ rubric: "R", input: "I", output: "O" })).rejects.toThrow(/ECONNREFUSED/);
  });
});
