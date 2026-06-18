import { mkdir, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import type { VmPaths } from "./state";
import type { Seed } from "./seed";
import type { Secrets } from "./secrets";

export async function renderHostState(paths: VmPaths, seed: Seed, secrets: Secrets): Promise<void> {
  await mkdir(paths.seed, { recursive: true });
  await mkdir(paths.runtime, { recursive: true });

  // Non-secret config only. Secrets are written separately under seed/secrets.
  const config = {
    name: seed.name,
    agent_name: seed.agent_name,
    timezone: seed.timezone,
    channels: seed.channels ?? {},
    routines: seed.routines ?? [],
    hatch_prompt: seed.hatch_prompt ?? "",
  };
  await writeFile(join(paths.seed, "config.json"), JSON.stringify(config, null, 2));

  const secDir = join(paths.seed, "secrets");
  await mkdir(secDir, { recursive: true });
  await chmod(secDir, 0o700);

  const groups: Record<string, string[]> = { anthropic: [], discord: [], github: [], extra: [] };
  for (const [k, v] of Object.entries(secrets.env)) {
    if (k.startsWith("ANTHROPIC_") || k.startsWith("CLAUDE_")) groups.anthropic!.push(`${k}=${v}`);
    else if (k.startsWith("DISCORD_")) groups.discord!.push(`${k}=${v}`);
    else if (k === "GH_TOKEN" || k.startsWith("GITHUB_")) groups.github!.push(`${k}=${v}`);
    else groups.extra!.push(`${k}=${v}`);
  }
  for (const [name, lines] of Object.entries(groups)) {
    if (lines.length === 0) continue;
    const f = join(secDir, `${name}.env`);
    await writeFile(f, lines.join("\n") + "\n");
    await chmod(f, 0o600);
  }
}
