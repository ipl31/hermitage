import { join } from "node:path";

export interface VmPaths {
  root: string; seed: string; runtime: string;
  image: string; socket: string; statusFile: string; logFile: string;
}

export function stateDir(name: string, home: string): VmPaths {
  const root = join(home, ".local/share/hermit-vm", name);
  const runtime = join(root, "runtime");
  return {
    root,
    seed: join(root, "seed"),
    runtime,
    image: join(root, "state.img"),
    socket: join(root, "hermit.sock"),
    statusFile: join(runtime, "status.json"),
    logFile: join(runtime, "hermit.log"),
  };
}
