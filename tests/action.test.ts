import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const bashPath = process.platform === "win32" ? (process.env.EVALGATE_TEST_BASH ?? "C:/Program Files/Git/bin/bash.exe") : "bash";
const fwd = (p: string) => p.replace(/\\/g, "/");
const probe = (cmd: string, args: string[]) => spawnSync(cmd, args, { encoding: "utf8" }).status === 0;
const hasBash = probe(bashPath, ["--version"]);
const hasGit = probe("git", ["--version"]);
const ready = hasBash && hasGit;
if (!ready) console.warn(`action e2e skipped: bash (${bashPath}) available=${hasBash}, git available=${hasGit}`);

const scripts = fwd(path.resolve("scripts/action"));
const GIT_ID = ["-c", "user.name=evalgate-test", "-c", "user.email=test@example.invalid"];

describe.skipIf(!ready)("action scripts end to end", () => {
  let tmp: string;
  let repo: string;
  let cli: string;
  let baseSha: string;
  let headSha: string;
  let runs = 0;

  const git = (...args: string[]) => {
    const r = spawnSync("git", [...GIT_ID, ...args], { cwd: repo, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
    return r.stdout.trim();
  };

  function runScript(name: string, env: Record<string, string>, runnerTemp: string) {
    const clean: NodeJS.ProcessEnv = { ...process.env };
    delete clean.TOY_AGENT_VARIANT;
    mkdirSync(runnerTemp, { recursive: true });
    const out = path.join(runnerTemp, "github-output.txt");
    const summary = path.join(runnerTemp, "step-summary.md");
    if (!existsSync(out)) writeFileSync(out, "");
    if (!existsSync(summary)) writeFileSync(summary, "");
    const r = spawnSync(bashPath, [`${scripts}/${name}.sh`], {
      cwd: repo,
      encoding: "utf8",
      env: {
        ...clean,
        EVALGATE: fwd(cli),
        SUITE: "evals/evalgate.yaml",
        RUNNER_TEMP: fwd(runnerTemp),
        GITHUB_OUTPUT: fwd(out),
        GITHUB_STEP_SUMMARY: fwd(summary),
        ...env,
      },
    });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, out, summary };
  }

  const freshTemp = () => path.join(tmp, `runner-${++runs}`);

  beforeAll(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "evalgate-action-"));
    cli = path.join(tmp, "cli.js");
    const b = spawnSync(process.execPath, ["scripts/build.mjs", "--outfile", cli], { encoding: "utf8" });
    if (b.status !== 0) throw new Error(`build failed: ${b.stderr}`);
    repo = path.join(tmp, "repo");
    mkdirSync(path.join(repo, "evals"), { recursive: true });
    copyFileSync("examples/toy-agent/agent.mjs", path.join(repo, "evals/agent.mjs"));
    copyFileSync("examples/toy-agent/evalgate.yaml", path.join(repo, "evals/evalgate.yaml"));
    git("init", "-b", "main");
    git("add", ".");
    git("commit", "-m", "base");
    baseSha = git("rev-parse", "HEAD");
    const agent = path.join(repo, "evals/agent.mjs");
    const src = readFileSync(agent, "utf8");
    const patched = src.replace('process.env.TOY_AGENT_VARIANT === "regressed"', "true");
    if (patched === src) throw new Error("could not patch the toy agent into the regressed variant");
    writeFileSync(agent, patched);
    git("add", ".");
    git("commit", "-m", "head: regressed");
    headSha = git("rev-parse", "HEAD");
  }, 60_000);

  afterAll(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  it("flags a regressed head, writes the comment and leaves no worktree behind", () => {
    git("checkout", "-q", headSha);
    const rt = freshTemp();
    expect(runScript("evaluate-head", {}, rt).status).toBe(0);
    expect(runScript("evaluate-base", { BASE_REF: baseSha }, rt).status).toBe(0);
    const cmp = runScript("compare", {}, rt);
    expect(cmp.status).toBe(0);
    expect(readFileSync(cmp.out, "utf8")).toContain("regression=true");
    const comment = readFileSync(path.join(rt, "evalgate-comment.md"), "utf8");
    expect(comment).toContain("FAIL");
    expect(comment).toContain("refund-window");
    expect(comment).toContain("injection-refusal");
    expect(readFileSync(cmp.summary, "utf8").length).toBeGreaterThan(0);
    expect(git("worktree", "list").split("\n")).toHaveLength(1);
  }, 60_000);

  it("survives a second base run with the same RUNNER_TEMP (stale worktree)", () => {
    git("checkout", "-q", headSha);
    const rt = freshTemp();
    expect(runScript("evaluate-base", { BASE_REF: baseSha }, rt).status).toBe(0);
    expect(runScript("evaluate-base", { BASE_REF: baseSha }, rt).status).toBe(0);
  }, 60_000);

  it("reports no regression when head equals base", () => {
    git("checkout", "-q", baseSha);
    const rt = freshTemp();
    expect(runScript("evaluate-head", {}, rt).status).toBe(0);
    expect(runScript("evaluate-base", { BASE_REF: baseSha }, rt).status).toBe(0);
    const cmp = runScript("compare", {}, rt);
    expect(cmp.status).toBe(0);
    expect(readFileSync(cmp.out, "utf8")).toContain("regression=false");
  }, 60_000);

  it("fails with exit 2 and an ::error:: when BASE_REF is empty", () => {
    const r = runScript("evaluate-base", { BASE_REF: "" }, freshTemp());
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("::error::");
  });
});
