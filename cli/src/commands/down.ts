import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { registerCommand, type CliDeps } from "../cli";
import { stateDir } from "../state";
import { buildRunner, stopVm } from "../vm";

registerCommand("down", async (argv: string[], deps: CliDeps): Promise<number> => {
  const name = argv.find((a) => !a.startsWith("--")) ?? "hermit";
  const wipe = argv.includes("--wipe");
  const paths = stateDir(name, homedir());
  if (!existsSync(paths.root)) { deps.error(`down: no such VM '${name}'`); return 1; }

  const runner = await buildRunner(deps);
  await stopVm(deps, runner, paths);
  deps.log(`stopped ${name}`);

  if (wipe) {
    deps.log(`wiping state at ${paths.root} — this is unconditional and irreversible`);
    await rm(paths.root, { recursive: true, force: true });
    deps.log("state deleted.");
  }
  return 0;
});
