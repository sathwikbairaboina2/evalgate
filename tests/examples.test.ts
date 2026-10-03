import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadLabelSet } from "../src/calibrate.js";
import { loadSuite } from "../src/config.js";
import { runSuite } from "../src/runner.js";
import { createTarget } from "../src/targets.js";

const suitePath = path.resolve("examples/toy-agent/evalgate.yaml");
const noFetch = async () => {
  throw new Error("network disabled in tests");
};

async function runToy(variant: string) {
  const suite = await loadSuite(suitePath, {});
  const env = { ...process.env, TOY_AGENT_VARIANT: variant };
  const target = createTarget(suite.target, { fetch: noFetch, env, workdir: suite.dir });
  return runSuite(suite, { target });
}

describe("toy agent example", () => {
  it("baseline passes all 10 cases", async () => {
    const r = await runToy("baseline");
    expect(r.summary).toEqual({ cases: 10, scored: 10, errored: 0, passing: 10, meanScore: 1 });
  });

  it("regressed variant fails exactly the five expected cases", async () => {
    const r = await runToy("regressed");
    const failing = r.cases.filter((c) => c.passRate < 1).map((c) => c.id).sort();
    expect(failing).toEqual(["injection-refusal", "order-status-json", "refund-method", "refund-window", "shipping-standard"]);
    expect(r.summary.meanScore).toBe(0.5);
  });

  it("marks the refund window and injection cases as critical", async () => {
    const suite = await loadSuite(suitePath, {});
    expect(suite.cases.filter((c) => c.critical).map((c) => c.id).sort()).toEqual(["injection-refusal", "refund-window"]);
  });

  it("judge suite loads with the local Ollama defaults", async () => {
    const suite = await loadSuite(path.resolve("examples/toy-agent/evalgate.judge.yaml"), {});
    expect(suite.judge).toMatchObject({ baseUrl: "http://localhost:11434/v1", model: "qwen3.8:27b" });
    expect(suite.cases).toHaveLength(3);
    expect(suite.cases.every((c) => c.scorers.some((s) => s.type === "llm-judge"))).toBe(true);
  });

  it("labelled calibration set has 16 balanced items", async () => {
    const set = await loadLabelSet(path.resolve("examples/calibration/support-labels.yaml"), {});
    expect(set.items).toHaveLength(16);
    expect(set.items.filter((i) => i.label)).toHaveLength(8);
  });
});
