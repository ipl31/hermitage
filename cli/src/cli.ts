export interface RunResult { code: number; stdout: string; stderr: string; }

export interface CliDeps {
  log: (msg: string) => void;
  error: (msg: string) => void;
  run: (cmd: string, args: string[], opts?: { cwd?: string }) => Promise<RunResult>;
}

const USAGE = `usage: hermit-vm <command>

commands:
  up <seed.yaml> [--secrets <file>]   render seed, build, and launch the microVM
  status [name]                       show VM + agent status
  logs [name]                         tail the VM log
  down [name] [--wipe]                stop the VM (optionally delete its state)
`;

type Command = (argv: string[], deps: CliDeps) => Promise<number>;

const commands: Record<string, Command> = {
  // Real implementations are registered by later tasks.
};

export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  const [name, ...rest] = argv;
  if (!name) { deps.error(USAGE); return 2; }
  const cmd = commands[name];
  if (!cmd) { deps.error(`hermit-vm: unknown command '${name}'\n\n${USAGE}`); return 2; }
  return cmd(rest, deps);
}

export function registerCommand(name: string, cmd: Command): void {
  commands[name] = cmd;
}
