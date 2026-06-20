import { writeFile, readFile, appendFile } from "node:fs/promises";
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
  // The vfkit runner attaches the guest console to stdio, which requires a real
  // TTY (a plain pipe makes vfkit abort with "operation not supported by
  // device"). Wrap the runner in a pseudo-TTY via macOS's BSD `script`, which
  // also captures the console to the log file.
  const proc = Bun.spawn(
    ["/usr/bin/script", "-q", paths.logFile, join(runnerPath, "bin", "microvm-run")],
    { cwd: paths.root, stdout: "ignore", stderr: "ignore", stdin: "ignore" },
  );
  proc.unref();
  await writeFile(join(paths.root, "vm.pid"), String(proc.pid));
  return proc.pid;
}

export async function stopVm(deps: CliDeps, runnerPath: string, paths: VmPaths): Promise<void> {
  // Try a graceful shutdown via the control socket first (best-effort).
  const shutdown = join(runnerPath, "bin", "microvm-shutdown");
  await deps.run(shutdown, [], { cwd: paths.root }).catch(() => undefined);

  // microvm-shutdown can report success while vfkit keeps running, and the
  // recorded vm.pid is the `script` wrapper, not vfkit. So verify the vfkit
  // process bound to THIS VM's control socket actually exits, then force-kill.
  // Absolute paths: the packaged CLI runs with a restricted PATH.
  const sockMatch = `vfkit.*${paths.socket}`;
  for (let i = 0; i < 20; i++) {
    const r = await deps.run("/usr/bin/pgrep", ["-f", sockMatch]);
    if (r.code !== 0) { await appendFile(paths.logFile, "[hermit-vm] stopped\n"); return; }
    await new Promise((res) => setTimeout(res, 500));
  }
  await deps.run("/usr/bin/pkill", ["-f", sockMatch]);
  try {
    const pid = parseInt(await readFile(join(paths.root, "vm.pid"), "utf8"), 10);
    if (pid > 0) process.kill(pid, "SIGKILL");
  } catch { /* already gone */ }
  await appendFile(paths.logFile, "[hermit-vm] force-stopped\n");
}
