import { describe, expect, it } from "vitest";
import { ConfigError, parseSuite } from "../src/config.js";

const minimal = `
name: demo
target:
  type: command
  command: node
  args: [agent.mjs]
cases:
  - id: greet
    input: hello
    scorers:
      - type: contains
        value: hi
`;

const withJudge = minimal.replace("- type: contains\n        value: hi", "- type: llm-judge\n        rubric: be nice");

describe("parseSuite", () => {
  it("applies defaults", () => {
    const s = parseSuite(minimal, "/suites", {});
    expect(s.name).toBe("demo");
    expect(s.dir).toBe("/suites");
    expect(s.repeats).toBe(1);
    expect(s.concurrency).toBe(4);
    expect(s.gate).toEqual({ minDelta: 0.02, alpha: 0.1, caseThreshold: 0.5, permutations: 10000, seed: 42 });
    expect(s.target).toMatchObject({ type: "command", command: "node", args: ["agent.mjs"], env: {}, timeoutMs: 30000 });
    expect(s.cases[0]).toMatchObject({
      id: "greet",
      critical: false,
      scorers: [{ type: "contains", value: ["hi"], caseSensitive: false }],
    });
    expect(s.judge).toBeUndefined();
  });

  it("parses an http target", () => {
    const text = minimal.replace(
      "  type: command\n  command: node\n  args: [agent.mjs]",
      "  type: http\n  url: http://localhost:8787/chat\n  outputPath: output.text",
    );
    const s = parseSuite(text, "/s", {});
    expect(s.target).toEqual({ type: "http", url: "http://localhost:8787/chat", headers: {}, inputField: "input", outputPath: "output.text", timeoutMs: 30000 });
  });

  it("rejects unknown keys and names the path", () => {
    const bad = minimal.replace("scorers:", "scorer:");
    expect(() => parseSuite(bad, "/s", {})).toThrow(ConfigError);
    expect(() => parseSuite(bad, "/s", {})).toThrow(/cases\.0/);
  });

  it("rejects duplicate case ids", () => {
    const dup = minimal + "  - id: greet\n    input: again\n    scorers:\n      - type: contains\n        value: hi\n";
    expect(() => parseSuite(dup, "/s", {})).toThrow(/duplicate case id: greet/);
  });

  it("rejects an invalid regex at load time", () => {
    const bad = minimal.replace("- type: contains\n        value: hi", '- type: regex\n        pattern: "("');
    expect(() => parseSuite(bad, "/s", {})).toThrow(/greet: invalid regex/);
  });

  it("rejects an invalid JSON schema at load time", () => {
    const bad = minimal.replace("- type: contains\n        value: hi", "- type: json-schema\n        schema: { type: 12 }");
    expect(() => parseSuite(bad, "/s", {})).toThrow(/greet: invalid JSON schema/);
  });

  it("rejects out-of-range gate values", () => {
    expect(() => parseSuite(minimal + "gate:\n  alpha: 2\n", "/s", {})).toThrow(/gate\.alpha/);
  });

  it("rejects invalid YAML", () => {
    expect(() => parseSuite("name: [", "/s", {})).toThrow(/invalid YAML/);
  });

  it("fills judge defaults when an llm-judge scorer is used", () => {
    const s = parseSuite(withJudge, "/s", {});
    expect(s.judge).toEqual({
      baseUrl: "http://localhost:11434/v1",
      model: "qwen3.8:27b",
      apiKeyEnv: "EVALGATE_JUDGE_API_KEY",
      temperature: 0,
      timeoutMs: 120000,
    });
  });

  it("lets env override judge baseUrl and model", () => {
    const s = parseSuite(withJudge, "/s", { EVALGATE_JUDGE_BASE_URL: "http://other/v1", EVALGATE_JUDGE_MODEL: "m2" });
    expect(s.judge).toMatchObject({ baseUrl: "http://other/v1", model: "m2" });
  });
});
