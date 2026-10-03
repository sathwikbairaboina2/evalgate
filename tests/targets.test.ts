import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTarget, expandEnv, getPath, TargetError, type TargetDeps } from "../src/targets.js";
import type { CommandTargetSpec, HttpTargetSpec } from "../src/types.js";

const cmd = (args: string[], over: Partial<CommandTargetSpec> = {}): CommandTargetSpec => ({
  type: "command",
  command: "node",
  args,
  env: {},
  timeoutMs: 5000,
  ...over,
});
const deps = (over: Partial<TargetDeps> = {}): TargetDeps => ({
  fetch: async () => {
    throw new Error("network disabled in tests");
  },
  env: process.env,
  workdir: process.cwd(),
  ...over,
});

describe("command target", () => {
  it("pipes input to stdin and returns stdout without the trailing newline", async () => {
    const t = createTarget(cmd(["-e", "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(s.toUpperCase()))"]), deps());
    await expect(t("hello")).resolves.toMatchObject({ output: "HELLO" });
  });
  it("rejects with the exit code and stderr on failure", async () => {
    const t = createTarget(cmd(["-e", "process.stderr.write('boom');process.exit(3)"]), deps());
    await expect(t("x")).rejects.toThrow(TargetError);
    await expect(t("x")).rejects.toThrow(/code 3: boom/);
  });
  it("times out", async () => {
    const t = createTarget(cmd(["-e", "setTimeout(()=>{},10000)"], { timeoutMs: 300 }), deps());
    await expect(t("x")).rejects.toThrow(/timed out after 300ms/);
  });
  it("merges spec env over the parent env", async () => {
    const t = createTarget(cmd(["-e", "process.stdout.write(process.env.GREETING)"], { env: { GREETING: "bonjour" } }), deps());
    await expect(t("x")).resolves.toMatchObject({ output: "bonjour" });
  });
  it("resolves cwd relative to the workdir", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "evalgate-"));
    await writeFile(path.join(dir, "echo.mjs"), "process.stdout.write('from-file')");
    const t = createTarget(cmd(["echo.mjs"]), deps({ workdir: dir }));
    await expect(t("x")).resolves.toMatchObject({ output: "from-file" });
  });
  it("reports a missing binary", async () => {
    const t = createTarget(cmd([], { command: "definitely-not-a-real-binary-xyz" }), deps());
    await expect(t("x")).rejects.toThrow(/failed to start/);
  });
});

describe("http target", () => {
  const spec = (over: Partial<HttpTargetSpec> = {}): HttpTargetSpec => ({
    type: "http",
    url: "http://agent.test/chat",
    headers: { authorization: "Bearer ${TOKEN}" },
    inputField: "message",
    outputPath: "output.text",
    timeoutMs: 1000,
    ...over,
  });
  function fakeFetch(status: number, body: string) {
    const calls: { url: string; init: RequestInit }[] = [];
    return {
      calls,
      fetch: async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(body, { status });
      },
    };
  }

  it("posts the input field, expands env in headers, and extracts outputPath", async () => {
    const f = fakeFetch(200, JSON.stringify({ output: { text: "hi there" } }));
    const t = createTarget(spec(), deps({ fetch: f.fetch, env: { TOKEN: "abc" } }));
    await expect(t("hello")).resolves.toMatchObject({ output: "hi there" });
    expect(f.calls[0].url).toBe("http://agent.test/chat");
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({ message: "hello" });
    expect((f.calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer abc");
  });
  it("uses urlOverride", async () => {
    const f = fakeFetch(200, JSON.stringify({ output: { text: "x" } }));
    await createTarget(spec(), deps({ fetch: f.fetch, urlOverride: "http://base.test/chat" }))("q");
    expect(f.calls[0].url).toBe("http://base.test/chat");
  });
  it("returns raw text without outputPath and stringifies non-string values", async () => {
    await expect(createTarget(spec({ outputPath: undefined }), deps({ fetch: fakeFetch(200, "plain").fetch }))("q")).resolves.toMatchObject({ output: "plain" });
    await expect(createTarget(spec({ outputPath: "n" }), deps({ fetch: fakeFetch(200, '{"n":{"a":1}}').fetch }))("q")).resolves.toMatchObject({ output: '{"a":1}' });
  });
  it("rejects on non-2xx and on a missing outputPath", async () => {
    await expect(createTarget(spec(), deps({ fetch: fakeFetch(503, "down").fetch }))("q")).rejects.toThrow(/HTTP 503/);
    await expect(createTarget(spec(), deps({ fetch: fakeFetch(200, "{}").fetch }))("q")).rejects.toThrow(/not found/);
  });
});

describe("helpers", () => {
  it("getPath walks objects and arrays", () => {
    expect(getPath({ choices: [{ message: { content: "c" } }] }, "choices.0.message.content")).toBe("c");
    expect(getPath({ a: 1 }, "a.b")).toBeUndefined();
  });
  it("expandEnv replaces ${VAR} and blanks unknown vars", () => {
    expect(expandEnv("Bearer ${T}-${MISSING}", { T: "x" })).toBe("Bearer x-");
  });
});
