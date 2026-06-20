import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { registerCommand, type CliDeps } from "../cli";
import { stateDir } from "../state";
import { readStatus } from "../status";

registerCommand("status", async (argv: string[], deps: CliDeps): Promise<number> => {
  const name = argv[0] ?? "hermit";
  const paths = stateDir(name, homedir());
  if (!existsSync(paths.root)) { deps.error(`status: no such VM '${name}'`); return 1; }
  const running = existsSync(join(paths.root, "vm.pid"));
  const s = await readStatus(paths);
  deps.log(`vm:     ${running ? "process recorded" : "not running"}`);
  const known = ["auth","channels","plugins","hatching","bootstrapped","running","awaiting_pairing","crashlooping","error"];
  deps.log(`phase:  ${s?.phase ?? "unknown"}${s && !known.includes(s.phase) ? " (?)" : ""}`);
  if (s?.error) deps.log(`error:  ${s.error}`);
  return 0;
});
