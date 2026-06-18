import { writeFile, readFile, appendFile } from "node:fs/promises";
import { openSync } from "node:fs";
import { join } from "node:path";
import type { CliDeps } from "./cli";
import type { VmPaths } from "./state";

const RUNNER_ATTR = ".#nixosConfigurations.hermit.config.microvm.declaredRunner";

export async function buildRunner(deps: CliDeps): Promise<string> {
  const r = await deps.run("nix", ["build", RUNNER_ATTR, "--no-link", "--print-out-paths"]);
  if (r.code !== 0) throw new Error(`nix build failed: ${r.stderr.trim()}`);
  const path = r.stdout.trim().split("\n").pop()!;
  if (!path) throw new Error("nix build produced no output path");
  return path;
}

export async function launchVm(_deps: CliDeps, runnerPath: string, paths: VmPaths): Promise<number> {
  const logFd = openSync(paths.logFile, "a");
  const proc = Bun.spawn([join(runnerPath, "bin", "microvm-run")], {
    cwd: paths.root,
    stdout: logFd,
    stderr: logFd,
    stdin: "ignore",
  });
  proc.unref();
  await writeFile(join(paths.root, "vm.pid"), String(proc.pid));
  return proc.pid;
}

export async function stopVm(deps: CliDeps, runnerPath: string, paths: VmPaths): Promise<void> {
  const shutdown = join(runnerPath, "bin", "microvm-shutdown");
  const r = await deps.run(shutdown, [], { cwd: paths.root });
  if (r.code === 0) { await appendFile(paths.logFile, "[hermit-vm] graceful shutdown sent\n"); return; }
  // Fallback: kill the recorded PID.
  try {
    const pid = parseInt(await readFile(join(paths.root, "vm.pid"), "utf8"), 10);
    if (pid > 0) process.kill(pid, "SIGTERM");
  } catch { /* already gone */ }
}
