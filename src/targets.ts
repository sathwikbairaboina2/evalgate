import { spawn } from "node:child_process";
import path from "node:path";
import type { CommandTargetSpec, FetchLike, HttpTargetSpec, TargetSpec } from "./types.js";

export interface TargetResult {
  output: string;
  latencyMs: number;
}

export type Target = (input: string) => Promise<TargetResult>;

export class TargetError extends Error {
  name = "TargetError";
}

export interface TargetDeps {
  fetch: FetchLike;
  env: NodeJS.ProcessEnv;
  /** Base directory for command targets' cwd (default: the suite file's directory). */
  workdir: string;
  /** Replaces the http target's url (e.g. a base deployment). */
  urlOverride?: string;
}

export function createTarget(spec: TargetSpec, deps: TargetDeps): Target {
  return spec.type === "command" ? commandTarget(spec, deps) : httpTarget(spec, deps);
}

function commandTarget(spec: CommandTargetSpec, deps: TargetDeps): Target {
  const cwd = path.resolve(deps.workdir, spec.cwd ?? ".");
  // "node" means "the node running evalgate", so suites work without PATH tweaks (and on Windows).
  const command = spec.command === "node" ? process.execPath : spec.command;
  return (input) =>
    new Promise<TargetResult>((resolve, reject) => {
      const started = performance.now();
      const child = spawn(command, spec.args, { cwd, env: { ...deps.env, ...spec.env }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
      child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
      const timer = setTimeout(() => {
        child.kill();
        reject(new TargetError(`timed out after ${spec.timeoutMs}ms`));
      }, spec.timeoutMs);
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(new TargetError(`failed to start ${spec.command}: ${e.message}`));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new TargetError(`exited with code ${code}: ${stderr.trim().slice(0, 500)}`));
          return;
        }
        resolve({ output: stdout.replace(/\r?\n$/, ""), latencyMs: performance.now() - started });
      });
      child.stdin.on("error", () => {
        // The child may exit before reading stdin (EPIPE); the close handler reports the real outcome.
      });
      child.stdin.end(input);
    });
}

function httpTarget(spec: HttpTargetSpec, deps: TargetDeps): Target {
  const url = deps.urlOverride ?? spec.url;
  const headers = Object.fromEntries(Object.entries(spec.headers).map(([k, v]) => [k, expandEnv(v, deps.env)]));
  return async (input) => {
    const started = performance.now();
    let res: Response;
    try {
      res = await deps.fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ [spec.inputField]: input }),
        signal: AbortSignal.timeout(spec.timeoutMs),
      });
    } catch (e) {
      throw new TargetError(`request to ${url} failed: ${(e as Error).message}`);
    }
    const text = await res.text();
    if (!res.ok) throw new TargetError(`HTTP ${res.status} from ${url}: ${text.slice(0, 500)}`);
    if (!spec.outputPath) return { output: text, latencyMs: performance.now() - started };
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new TargetError(`response from ${url} is not JSON, but outputPath is set`);
    }
    const value = getPath(json, spec.outputPath);
    if (value === undefined) throw new TargetError(`outputPath "${spec.outputPath}" not found in response`);
    return { output: typeof value === "string" ? value : JSON.stringify(value), latencyMs: performance.now() - started };
  };
}

export function getPath(obj: unknown, dotted: string): unknown {
  return dotted
    .split(".")
    .reduce<unknown>((acc, key) => (acc !== null && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), obj);
}

export function expandEnv(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/\$\{([A-Za-z0-9_]+)\}/g, (_, name: string) => env[name] ?? "");
}
