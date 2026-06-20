import { mkdirSync, writeFileSync, copyFileSync, existsSync, chmodSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readEnvFiles, resolveAuth, claudeJson, agentEnvContent } from "./lib";

const SEED = "/run/hermit-seed";
const RUNTIME = "/run/hermit-runtime";
const VOL = "/var/lib/hermit";
const CONFIG_DIR = join(VOL, ".claude");
const PROJECT = join(VOL, "project");
const MARKER = join(VOL, ".hermit-initialized");

function setStatus(phase: string, extra: Record<string, unknown> = {}): void {
  writeFileSync(join(RUNTIME, "status.json"),
    JSON.stringify({ phase, ts: Math.floor(Date.now() / 1000), ...extra }));
}
function logLine(msg: string): void {
  Bun.write(join(RUNTIME, "hermit.log"), `[bootstrap] ${msg}\n`); // append handled by service log too
}

async function sh(cmd: string[], env: Record<string, string>): Promise<void> {
  const proc = Bun.spawn(cmd, {
    cwd: PROJECT,
    // IS_SANDBOX=1 lets `claude --dangerously-skip-permissions` run as root,
    // which it otherwise refuses. The microVM is a single-purpose sandbox.
    env: { ...process.env, ...env, CLAUDE_CONFIG_DIR: CONFIG_DIR, IS_SANDBOX: "1" },
    stdout: "inherit", stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`command failed (${code}): ${cmd.join(" ")}`);
}

async function claudeVersion(): Promise<string> {
  const p = Bun.spawn(["claude", "--version"], { stdout: "pipe" });
  const out = (await new Response(p.stdout).text()).trim();
  await p.exited;
  return out.split(/\s+/)[0] ?? "unknown";
}

export async function main(): Promise<void> {
  mkdirSync(RUNTIME, { recursive: true });
  mkdirSync(CONFIG_DIR, { recursive: true });
  mkdirSync(PROJECT, { recursive: true });

  const cfg = JSON.parse(existsSync(join(SEED, "config.json"))
    ? await Bun.file(join(SEED, "config.json")).text() : "{}");
  const secrets = readEnvFiles(join(SEED, "secrets"));

  // ---- auth ----
  setStatus("auth");
  const { authEnv, credsSource, warning } = resolveAuth(secrets);
  if (warning) logLine("WARN: " + warning);
  if (credsSource && existsSync(credsSource)) {
    copyFileSync(credsSource, join(CONFIG_DIR, ".credentials.json"));
    chmodSync(join(CONFIG_DIR, ".credentials.json"), 0o600);
  }

  // ---- channels ----
  setStatus("channels");
  const discordEnabled = !!cfg?.channels?.discord?.enabled;
  const channelMcp: string[] = [];
  const extraAgentEnv: Record<string, string> = {};
  if (discordEnabled) {
    if (!secrets.DISCORD_BOT_TOKEN) {
      throw new Error("discord channel enabled but DISCORD_BOT_TOKEN missing from seed secrets");
    }
    const stateDir = join(VOL, "channels/discord");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, ".env"), `DISCORD_BOT_TOKEN=${secrets.DISCORD_BOT_TOKEN}\n`);
    chmodSync(join(stateDir, ".env"), 0o600);
    // If the operator pre-paired elsewhere and shipped access.json, reuse it.
    const seededAccess = join(SEED, "secrets", "discord-access.json");
    if (existsSync(seededAccess)) copyFileSync(seededAccess, join(stateDir, "access.json"));
    // Register the state dir for hermit's channel layer via settings.local.json.
    const settingsLocal = join(PROJECT, ".claude", "settings.local.json");
    mkdirSync(join(PROJECT, ".claude"), { recursive: true });
    const existing = existsSync(settingsLocal) ? JSON.parse(await Bun.file(settingsLocal).text()) : {};
    existing.env = { ...(existing.env ?? {}), DISCORD_STATE_DIR: stateDir };
    writeFileSync(settingsLocal, JSON.stringify(existing, null, 2));
    extraAgentEnv.DISCORD_BOT_TOKEN = secrets.DISCORD_BOT_TOKEN;
    extraAgentEnv.DISCORD_STATE_DIR = stateDir;
    channelMcp.push("discord");
  }

  // ---- onboarding/trust/MCP bypass ----
  const version = await claudeVersion();
  writeFileSync(join(CONFIG_DIR, ".claude.json"),
    JSON.stringify(claudeJson(version, PROJECT, channelMcp), null, 2));

  // ---- plugins ----
  setStatus("plugins");
  await sh(["claude", "plugin", "marketplace", "add", "gtapps/claude-code-hermit"], authEnv);
  await sh(["claude", "plugin", "install", "claude-code-hermit@claude-code-hermit", "--scope", "local"], authEnv);
  if (discordEnabled) {
    await sh(["claude", "plugin", "marketplace", "add", "anthropics/claude-plugins-official"], authEnv);
    await sh(["claude", "plugin", "install", "discord@claude-plugins-official", "--scope", "local"], authEnv);
  }

  // ---- hatch (best-effort, model-driven soft setup) ----
  setStatus("hatching");
  const prompt = String(cfg.hatch_prompt ?? "Use Quick setup with sensible defaults; proceed without asking questions.")
    + ` Agent name: ${cfg.agent_name ?? "Hermit"}. Timezone: ${cfg.timezone ?? "UTC"}. Target this project directory. Do not enable Docker.`;
  // NOTE: --dangerously-skip-permissions and --permission-mode are mutually
  // exclusive in the CLI. For unattended hatch we want the full bypass.
  await sh(["claude", "-p", `/claude-code-hermit:hatch ${prompt}`,
    "--dangerously-skip-permissions",
    "--model", "sonnet", "--output-format", "stream-json", "--verbose"], authEnv);

  // hatch must have produced the session launcher; if not, fail loudly.
  const starter = join(PROJECT, ".claude-code-hermit", "bin", "hermit-start");
  if (!existsSync(starter)) throw new Error("hatch did not create .claude-code-hermit/bin/hermit-start");

  // hatch writes bin/* via the Write tool (mode 0644) and can't chmod them
  // itself (no Bash in -p mode), so make them executable — otherwise systemd's
  // ExecStart on hermit-start fails and hermit-agent crash-loops.
  const binDir = join(PROJECT, ".claude-code-hermit", "bin");
  for (const f of readdirSync(binDir)) chmodSync(join(binDir, f), 0o755);

  // ---- write the agent EnvironmentFile (host can later rewrite for reseed) ----
  const agentVars: Record<string, string> = {
    ...authEnv, ...extraAgentEnv,
    CLAUDE_CONFIG_DIR: CONFIG_DIR,
    AGENT_HOOK_PROFILE: "standard",
    // The session runs as root in this sandbox VM; allow the permission bypass.
    IS_SANDBOX: "1",
  };
  if (secrets.GH_TOKEN) agentVars.GH_TOKEN = secrets.GH_TOKEN;
  writeFileSync(join(RUNTIME, "agent.env"), agentEnvContent(agentVars));
  chmodSync(join(RUNTIME, "agent.env"), 0o600);

  // ---- done ----
  writeFileSync(MARKER, new Date().toISOString());
  setStatus("bootstrapped");
}

main().catch((e) => {
  try { setStatus("error", { error: String(e?.message ?? e) }); } catch { /* noop */ }
  process.exit(1);
});
