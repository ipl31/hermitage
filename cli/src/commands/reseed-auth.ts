import { readFile, writeFile, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { registerCommand, type CliDeps } from "../cli";
import { stateDir } from "../state";
import { parseSecrets } from "../secrets";

const AUTH_KEYS = ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_OAUTH_CREDS"];

export function rewriteAuth(current: string, authEnv: Record<string, string>): string {
  const kept = current.split("\n").filter((l) => {
    const k = l.split("=")[0]?.trim();
    return l.trim() && k && !AUTH_KEYS.includes(k);
  });
  const auth = Object.entries(authEnv).map(([k, v]) => `${k}=${v}`);
  return [...auth, ...kept].join("\n") + "\n";
}

function authEnvFromSecrets(env: Record<string, string>): Record<string, string> {
  if (env.ANTHROPIC_API_KEY) return { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY };
  if (env.CLAUDE_CODE_OAUTH_TOKEN) return { CLAUDE_CODE_OAUTH_TOKEN: env.CLAUDE_CODE_OAUTH_TOKEN };
  return {};
}

registerCommand("reseed-auth", async (argv: string[], deps: CliDeps): Promise<number> => {
  const name = argv.find((a) => !a.startsWith("--")) ?? "hermit";
  const i = argv.indexOf("--secrets");
  const secretsPath = i >= 0 ? argv[i + 1] : undefined;
  if (!secretsPath || !existsSync(secretsPath)) { deps.error("reseed-auth: --secrets <file> required"); return 2; }

  const paths = stateDir(name, homedir());
  if (!existsSync(paths.runtime)) { deps.error(`reseed-auth: no such VM '${name}'`); return 1; }

  const secrets = parseSecrets(await readFile(secretsPath, "utf8"));
  const auth = authEnvFromSecrets(secrets.env);
  if (Object.keys(auth).length === 0) { deps.error("reseed-auth: only API key / OAuth token are reseedable live"); return 1; }

  const agentEnvPath = `${paths.runtime}/agent.env`;
  const current = existsSync(agentEnvPath) ? await readFile(agentEnvPath, "utf8") : "";
  const next = rewriteAuth(current, auth);
  await writeFile(agentEnvPath + ".tmp", next);
  await chmod(agentEnvPath + ".tmp", 0o600);
  await deps.run("mv", [agentEnvPath + ".tmp", agentEnvPath]); // atomic; triggers guest path unit
  deps.log(`reseeded auth for ${name}; the agent will restart automatically.`);
  return 0;
});
