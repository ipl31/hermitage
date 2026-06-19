import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { registerCommand, type CliDeps } from "../cli";
import { stateDir } from "../state";

registerCommand("logs", async (argv: string[], deps: CliDeps): Promise<number> => {
  const name = argv[0] ?? "hermit";
  const paths = stateDir(name, homedir());
  if (!existsSync(paths.logFile)) { deps.error(`logs: no log for '${name}'`); return 1; }
  const r = await deps.run("tail", ["-n", "200", "-f", paths.logFile]);
  return r.code;
});
