import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { registerCommand, type CliDeps } from "../cli";
import { parseSeed } from "../seed";
import { parseSecrets } from "../secrets";
import { stateDir } from "../state";
import { renderHostState } from "../render";
import { preflight } from "../preflight";
import { buildRunner, launchVm } from "../vm";
import { pollStatus } from "../status";

export function wantsRehatch(argv: string[]): boolean {
  return argv.includes("--rehatch");
}

export function parseUpArgs(argv: string[]): { seedPath?: string; secretsPath?: string } {
  let seedPath: string | undefined;
  let secretsPath: string | undefined;
  let i = 0;
  while (i < argv.length) {
    const a = argv[i]!;
    if (a === "--secrets") {
      secretsPath = argv[i + 1];
      i += 2;
    } else if (a.startsWith("--")) {
      i += 1; // ignore unknown flags (e.g. --rehatch)
    } else {
      if (seedPath === undefined) seedPath = a;
      i += 1;
    }
  }
  return { seedPath, secretsPath };
}

registerCommand("up", async (argv: string[], deps: CliDeps): Promise<number> => {
  const { seedPath, secretsPath: secretsArg } = parseUpArgs(argv);
  if (!seedPath) { deps.error("up: missing <seed.yaml>"); return 2; }

  const pf = await preflight(deps);
  if (!pf.ok) { deps.error("preflight failed:\n" + pf.problems.join("\n\n")); return 1; }

  const seed = parseSeed(await readFile(seedPath, "utf8"));
  const secretsPath = secretsArg
    ?? (seed.secrets_file ? resolve(dirname(seedPath), seed.secrets_file) : undefined);
  if (!secretsPath || !existsSync(secretsPath)) { deps.error("up: secrets file not found"); return 1; }
  const secrets = parseSecrets(await readFile(secretsPath, "utf8"));

  const paths = stateDir(seed.name, homedir());
  deps.log(`rendering host state at ${paths.root}`);
  await renderHostState(paths, seed, secrets);

  if (wantsRehatch(argv)) {
    await Bun.write(`${paths.runtime}/rehatch-request`, new Date().toISOString());
    deps.log("rehatch requested; the guest will re-run setup on next boot/now.");
  }

  deps.log("building microVM runner (this can take a while on first run)...");
  const runner = await buildRunner(deps);

  deps.log("launching microVM...");
  const pid = await launchVm(deps, runner, paths);
  deps.log(`microVM started (pid ${pid}); waiting for status=ready...`);

  const s = await pollStatus(paths, "ready", 120_000);
  if (s?.phase === "ready") {
    deps.log(`✅ ${seed.name} is ready.`);
    deps.log(`   status: ${paths.statusFile}`);
    deps.log(`   logs:   hermit-vm logs ${seed.name}`);
    return 0;
  }
  deps.error(`timed out waiting for ready (last phase: ${s?.phase ?? "none"}). See: hermit-vm logs ${seed.name}`);
  return 1;
});
