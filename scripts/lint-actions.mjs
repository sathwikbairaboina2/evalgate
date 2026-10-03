// Lint the GitHub workflows with actionlint and the action's bash with ShellCheck (both from one pinned image).
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

const IMAGE = "rhysd/actionlint:1.7.12";
const cwd = process.cwd();
const mount = ["-v", `${cwd}:/repo`, "-w", "/repo"];

const shellFiles = [
  ...readdirSync("scripts/action")
    .filter((f) => f.endsWith(".sh"))
    .sort()
    .map((f) => `scripts/action/${f}`),
  "scripts/docker-example.sh",
];

function docker(label, args) {
  console.log(`\n== ${label} ==`);
  const r = spawnSync("docker", ["run", "--rm", ...args], { stdio: "inherit" });
  if (r.error) {
    console.error(`could not run docker: ${r.error.message}`);
    return false;
  }
  console.log(r.status === 0 ? `${label}: ok` : `${label}: failed (exit ${r.status})`);
  return r.status === 0;
}

const a = docker("actionlint", ["--name", `evalgate-actionlint-${process.pid}`, ...mount, IMAGE, "-no-color", "-oneline"]);
const s = docker("shellcheck", ["--name", `evalgate-shellcheck-${process.pid}`, "--entrypoint", "shellcheck", ...mount, IMAGE, "-S", "style", ...shellFiles]);
process.exit(a && s ? 0 : 1);
