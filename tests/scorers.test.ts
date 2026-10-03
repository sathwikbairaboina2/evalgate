import { describe, expect, it } from "vitest";
import { compileJsonSchema, parseJsonOutput, scoreDeterministic } from "../src/scorers.js";

describe("exact", () => {
  it("trims both sides", () => {
    const r = scoreDeterministic(" 42 \n", { type: "exact", value: "42", caseSensitive: true });
    expect(r).toMatchObject({ type: "exact", pass: true, score: 1 });
  });
  it("respects caseSensitive", () => {
    expect(scoreDeterministic("Yes", { type: "exact", value: "yes", caseSensitive: true }).pass).toBe(false);
    expect(scoreDeterministic("Yes", { type: "exact", value: "yes", caseSensitive: false }).pass).toBe(true);
  });
});

describe("contains / not-contains", () => {
  it("requires every needle and names the missing ones", () => {
    const r = scoreDeterministic("Refunds within 30 DAYS.", {
      type: "contains",
      value: ["30 days", "original payment method"],
      caseSensitive: false,
    });
    expect(r.pass).toBe(false);
    expect(r.score).toBe(0);
    expect(r.reason).toContain("original payment method");
  });
  it("is case-insensitive when asked", () => {
    expect(scoreDeterministic("30 DAYS", { type: "contains", value: ["30 days"], caseSensitive: false }).pass).toBe(true);
    expect(scoreDeterministic("30 DAYS", { type: "contains", value: ["30 days"], caseSensitive: true }).pass).toBe(false);
  });
  it("not-contains fails on any forbidden needle", () => {
    const r = scoreDeterministic("code STAFF50", { type: "not-contains", value: ["system prompt", "staff50"], caseSensitive: false });
    expect(r.pass).toBe(false);
    expect(r.reason).toContain("staff50");
    expect(scoreDeterministic("all good", { type: "not-contains", value: ["STAFF50"], caseSensitive: false }).pass).toBe(true);
  });
});

describe("regex", () => {
  it("matches with flags", () => {
    expect(scoreDeterministic("Hi! there", { type: "regex", pattern: "^Hi!", flags: "" }).pass).toBe(true);
    expect(scoreDeterministic("hi! there", { type: "regex", pattern: "^Hi!", flags: "" }).pass).toBe(false);
    expect(scoreDeterministic("hi! there", { type: "regex", pattern: "^Hi!", flags: "i" }).pass).toBe(true);
  });
  it("is not stateful with the g flag", () => {
    const s = { type: "regex" as const, pattern: "a", flags: "g" };
    expect(scoreDeterministic("a", s).pass).toBe(true);
    expect(scoreDeterministic("a", s).pass).toBe(true);
  });
});

describe("json-schema", () => {
  const schema = {
    type: "object",
    required: ["orderId", "etaDays"],
    properties: { orderId: { type: "string" }, etaDays: { type: "integer" } },
  };
  it("passes valid JSON", () => {
    expect(scoreDeterministic('{"orderId":"1","etaDays":2}', { type: "json-schema", schema }).pass).toBe(true);
  });
  it("accepts a fenced json block", () => {
    const out = 'Here you go:\n```json\n{"orderId":"1","etaDays":2}\n```';
    expect(scoreDeterministic(out, { type: "json-schema", schema }).pass).toBe(true);
  });
  it("fails non-JSON with a clear reason", () => {
    const r = scoreDeterministic("not json", { type: "json-schema", schema });
    expect(r.pass).toBe(false);
    expect(r.reason).toMatch(/not valid JSON/);
  });
  it("reports the failing property", () => {
    const r = scoreDeterministic('{"orderId":"1","etaDays":"two"}', { type: "json-schema", schema });
    expect(r.pass).toBe(false);
    expect(r.reason).toContain("etaDays");
  });
});

describe("helpers", () => {
  it("compileJsonSchema throws on an invalid schema", () => {
    expect(() => compileJsonSchema({ type: 12 })).toThrow();
  });
  it("parseJsonOutput reports failure", () => {
    expect(parseJsonOutput("{")).toEqual({ ok: false });
    expect(parseJsonOutput(" [1] ")).toEqual({ ok: true, value: [1] });
  });
});
