# Hermit microVM Deployer — Plan 2: Hermit Bootstrap + Session

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Prerequisite:** Plan 1 (`2026-06-18-hermit-microvm-deployer-plan-1-vm-skeleton.md`) must be complete — this plan reuses its flake, guest module, `CliDeps`, `Seed`, `Secrets`, `VmPaths`, `Status`, the `up/status/logs/down` commands, and the host state-dir layout.

**Goal:** Turn the empty Plan 1 microVM into a self-bootstrapping Hermit agent: on first boot it deterministically pre-seeds the stable, well-documented bits (auth, onboarding/trust bypass, plugin install, MCP approval, Discord token) and then runs `/claude-code-hermit:hatch <prompt>` to let the model do the soft setup; a long-running systemd service then runs the never-ending session via `hermit-start --no-tmux`. Adds `reseed-auth` and `--rehatch`.

**Architecture:** Two-phase systemd inside the guest — `hermit-init.service` (oneshot, marker-guarded) runs a Bun bootstrap script; `hermit-agent.service` (`Restart=always`) starts only after init succeeds and runs Hermit's own `hermit-start --no-tmux`. The bootstrap writes status phases to the runtime share so the host CLI can observe progress. Auth env lives in `runtime/agent.env` (RW share) so the host can rewrite it; a guest path unit restarts the agent when it changes (`reseed-auth`) or re-hatches on request (`--rehatch`). Per the research, only stable/documented files are pre-seeded; uncertain, version-fragile state (`config.json`, `OPERATOR.md`, `bin/hermit-start`) is left for `hatch` to create.

**Tech Stack:** Same as Plan 1, plus in-guest `pkgs.claude-code` (unfree), `pkgs.bun`, `pkgs.nodejs_22`, `pkgs.git`, `pkgs.gh`, `pkgs.jq`; systemd oneshot/path units.

## Global Constraints

- Inherits **all** Plan 1 Global Constraints (macOS/aarch64-darwin host, aarch64-linux guest, vfkit, relative paths + runner CWD, fixed sizing, secrets perms).
- `pkgs.claude-code` is **unfree** → the guest sets `nixpkgs.config.allowUnfree = true` (or a scoped predicate).
- In-guest paths (fixed): `CLAUDE_CONFIG_DIR = /var/lib/hermit/.claude`; project dir = `/var/lib/hermit/project`; first-boot marker = `/var/lib/hermit/.hermit-initialized`. All on the **persistent volume** so they survive reboots.
- `runtime/agent.env` (RW runtime share) holds the agent service's `EnvironmentFile`; the host owns it (so `reseed-auth` can rewrite it).
- **Auth precedence / robustness:** prefer `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`). A copied `.credentials.json` (`CLAUDE_OAUTH_CREDS`) is supported but flagged as "may not auto-refresh headless."
- **Pre-seed only stable/documented artifacts:** auth env / creds file, `$CLAUDE_CONFIG_DIR/.claude.json` (`hasCompletedOnboarding`, `lastOnboardingVersion`, `projects.<dir>.hasTrustDialogAccepted`, `enabledMcpjsonServers`), plugin installs, Discord `DISCORD_BOT_TOKEN` + `DISCORD_STATE_DIR`. **Do NOT hand-write** `config.json`/`OPERATOR.md`/`bin/hermit-start` — `hatch` creates those.
- **Discord pairing is inherently interactive** (research-preview). Pre-seed only the token (and copy an existing `access.json` if the seed provides one). Treat first-time pairing as a documented manual step; do not block `up` forever on it.
- Status phases (written to `runtime/status.json` `.phase`): `auth` → `channels` → `plugins` → `hatching` → `bootstrapped` → `running`; plus terminal `error` (with `.error`) and `awaiting_pairing`. `up` in this plan polls until `running` (or `awaiting_pairing`).
- Exact plugin commands (verbatim): `claude plugin marketplace add gtapps/claude-code-hermit`; `claude plugin install claude-code-hermit@claude-code-hermit --scope local`; `claude plugin marketplace add anthropics/claude-plugins-official`; `claude plugin install discord@claude-plugins-official --scope local`.
- Headless hatch invocation (verbatim flags): `claude -p "/claude-code-hermit:hatch <prompt>" --permission-mode acceptEdits --dangerously-skip-permissions --model sonnet --output-format stream-json --verbose`.
- Session command (verbatim): `<project>/.claude-code-hermit/bin/hermit-start --no-tmux`.
- Commit after every task. Conventional Commit messages.

---

### Task 1: Guest runtime packages + persistent layout

**Files:**
- Modify: `nix/guest-config.nix`
- Create: `nix/runtime-packages.nix`

**Interfaces:**
- Produces: a guest that has `claude-code`, `bun`, `nodejs_22`, `git`, `gh`, `jq`, `socat`, `coreutils` on PATH; `allowUnfree`; and `systemd.tmpfiles` rules creating `/var/lib/hermit/.claude` and `/var/lib/hermit/project` (mode 0700, owned by root — the agent runs as root in this single-tenant VM).
- Consumes: the `/var/lib/hermit` volume from Plan 1.

- [ ] **Step 1: Write `nix/runtime-packages.nix`**

```nix
{ pkgs, ... }:
{
  nixpkgs.config.allowUnfree = true;  # claude-code is unfree

  environment.systemPackages = with pkgs; [
    claude-code bun nodejs_22 git gh jq socat coreutils
  ];

  # Persistent layout on the /var/lib/hermit volume.
  systemd.tmpfiles.rules = [
    "d /var/lib/hermit 0700 root root - -"
    "d /var/lib/hermit/.claude 0700 root root - -"
    "d /var/lib/hermit/project 0700 root root - -"
  ];
}
```

- [ ] **Step 2: Modify `nix/guest-config.nix`** — import runtime packages and drop the Plan 1 placeholder

Change the `imports` line from `imports = [ ./status-writer.nix ];` to:

```nix
  imports = [ ./runtime-packages.nix ./hermit-services.nix ];
```

(Removes `status-writer.nix` from the build; `hermit-services.nix` is created in Task 4. Delete `nix/status-writer.nix`.)

- [ ] **Step 3: Delete the placeholder**

Run: `git rm nix/status-writer.nix`
Expected: file removed.

- [ ] **Step 4: Verify the guest still evaluates** (it will fail to build until Task 4 adds `hermit-services.nix` — that's expected; just check eval of packages)

Run: `nix eval .#nixosConfigurations.hermit.config.nixpkgs.config.allowUnfree`
Expected: `true`.

- [ ] **Step 5: Commit**

```bash
git add nix/runtime-packages.nix nix/guest-config.nix
git commit -m "feat: guest runtime packages and persistent hermit layout"
```

---

### Task 2: Bootstrap pure helpers (auth, .claude.json, agent.env, secrets dir)

**Files:**
- Create: `guest/bootstrap/lib.ts`
- Test: `guest/bootstrap/lib.test.ts`

**Interfaces:**
- Produces (pure, no I/O except where noted):
  - `readEnvFiles(dir: string): Record<string,string>` — reads every `*.env` in `dir`, parses `KEY=VALUE` lines (reusing the same rules as Plan 1's secrets parser), merges. Missing dir → `{}`.
  - `resolveAuth(env: Record<string,string>): { authEnv: Record<string,string>; credsSource?: string; warning?: string }` — returns the env vars to export for auth, the path to a creds file to copy (for `CLAUDE_OAUTH_CREDS`), and an optional warning string.
  - `claudeJson(version: string, projectDir: string, mcpServers: string[]): object` — the `.claude.json` content for onboarding/trust/MCP bypass.
  - `agentEnvContent(vars: Record<string,string>): string` — serializes `KEY=VALUE\n` lines for the systemd `EnvironmentFile`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test `guest/bootstrap/lib.test.ts`**

```ts
import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEnvFiles, resolveAuth, claudeJson, agentEnvContent } from "./lib";

test("readEnvFiles merges *.env files", () => {
  const d = mkdtempSync(join(tmpdir(), "s-"));
  writeFileSync(join(d, "anthropic.env"), "ANTHROPIC_API_KEY=k\n# c\n");
  writeFileSync(join(d, "discord.env"), 'DISCORD_BOT_TOKEN="t"\n');
  const env = readEnvFiles(d);
  expect(env.ANTHROPIC_API_KEY).toBe("k");
  expect(env.DISCORD_BOT_TOKEN).toBe("t");
});

test("resolveAuth: api key", () => {
  const r = resolveAuth({ ANTHROPIC_API_KEY: "k" });
  expect(r.authEnv.ANTHROPIC_API_KEY).toBe("k");
  expect(r.credsSource).toBeUndefined();
});

test("resolveAuth: oauth token", () => {
  const r = resolveAuth({ CLAUDE_CODE_OAUTH_TOKEN: "tok" });
  expect(r.authEnv.CLAUDE_CODE_OAUTH_TOKEN).toBe("tok");
});

test("resolveAuth: oauth creds returns source + warning", () => {
  const r = resolveAuth({ CLAUDE_OAUTH_CREDS: "/run/hermit-seed/secrets/creds.json" });
  expect(r.credsSource).toBe("/run/hermit-seed/secrets/creds.json");
  expect(r.warning).toContain("refresh");
});

test("claudeJson sets onboarding + trust + mcp", () => {
  const j = claudeJson("2.1.179", "/var/lib/hermit/project", ["discord"]) as any;
  expect(j.hasCompletedOnboarding).toBe(true);
  expect(j.lastOnboardingVersion).toBe("2.1.179");
  expect(j.projects["/var/lib/hermit/project"].hasTrustDialogAccepted).toBe(true);
  expect(j.enabledMcpjsonServers).toEqual(["discord"]);
});

test("agentEnvContent serializes", () => {
  expect(agentEnvContent({ A: "1", B: "2" })).toBe("A=1\nB=2\n");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd guest/bootstrap && bun test lib.test.ts`
Expected: FAIL — cannot find module `./lib`.

- [ ] **Step 3: Write `guest/bootstrap/lib.ts`**

```ts
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[k] = v;
  }
  return env;
}

export function readEnvFiles(dir: string): Record<string, string> {
  if (!existsSync(dir)) return {};
  const out: Record<string, string> = {};
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".env")) continue;
    Object.assign(out, parseEnv(readFileSync(join(dir, f), "utf8")));
  }
  return out;
}

export function resolveAuth(env: Record<string, string>): {
  authEnv: Record<string, string>; credsSource?: string; warning?: string;
} {
  if (env.ANTHROPIC_API_KEY) return { authEnv: { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY } };
  if (env.CLAUDE_CODE_OAUTH_TOKEN) return { authEnv: { CLAUDE_CODE_OAUTH_TOKEN: env.CLAUDE_CODE_OAUTH_TOKEN } };
  if (env.CLAUDE_OAUTH_CREDS) {
    return {
      authEnv: {},
      credsSource: env.CLAUDE_OAUTH_CREDS,
      warning: "copied OAuth credentials may not auto-refresh on a headless VM; prefer CLAUDE_CODE_OAUTH_TOKEN",
    };
  }
  throw new Error("no Claude auth found in seed secrets");
}

export function claudeJson(version: string, projectDir: string, mcpServers: string[]): object {
  return {
    hasCompletedOnboarding: true,
    lastOnboardingVersion: version,
    projects: { [projectDir]: { hasTrustDialogAccepted: true, hasTrustDialogHooksAccepted: true } },
    enabledMcpjsonServers: mcpServers,
  };
}

export function agentEnvContent(vars: Record<string, string>): string {
  return Object.entries(vars).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd guest/bootstrap && bun test lib.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add guest/bootstrap/lib.ts guest/bootstrap/lib.test.ts
git commit -m "feat: bootstrap pure helpers (auth, claude.json, env)"
```

---

### Task 3: Bootstrap orchestrator (main) — pre-seed + plugins + hatch

**Files:**
- Create: `guest/bootstrap/main.ts`

**Interfaces:**
- Consumes: `guest/bootstrap/lib.ts` (Task 2). Reads `/run/hermit-seed/config.json` + `/run/hermit-seed/secrets/`; writes `/run/hermit-runtime/{status.json,hermit.log,agent.env}`, `$CLAUDE_CONFIG_DIR/.claude.json` (+ `.credentials.json` for oauth-creds), and the marker. Spawns `claude` for plugin installs and `hatch`.
- Produces: a runnable `main()` that drives phases `auth→channels→plugins→hatching→bootstrapped`, writing `status.json` at each. On any throw, writes `{phase:"error",error}` and exits non-zero (so `hermit-init.service` fails and `hermit-agent` won't start).

- [ ] **Step 1: Write `guest/bootstrap/main.ts`**

```ts
import { mkdirSync, writeFileSync, copyFileSync, existsSync, chmodSync } from "node:fs";
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
    env: { ...process.env, ...env, CLAUDE_CONFIG_DIR: CONFIG_DIR },
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
    const stateDir = join(VOL, "channels/discord");
    mkdirSync(stateDir, { recursive: true });
    if (secrets.DISCORD_BOT_TOKEN) {
      writeFileSync(join(stateDir, ".env"), `DISCORD_BOT_TOKEN=${secrets.DISCORD_BOT_TOKEN}\n`);
      chmodSync(join(stateDir, ".env"), 0o600);
    }
    // If the operator pre-paired elsewhere and shipped access.json, reuse it.
    const seededAccess = join(SEED, "secrets", "discord-access.json");
    if (existsSync(seededAccess)) copyFileSync(seededAccess, join(stateDir, "access.json"));
    // Register the state dir for hermit's channel layer via settings.local.json.
    const settingsLocal = join(PROJECT, ".claude", "settings.local.json");
    mkdirSync(join(PROJECT, ".claude"), { recursive: true });
    const existing = existsSync(settingsLocal) ? JSON.parse(await Bun.file(settingsLocal).text()) : {};
    existing.env = { ...(existing.env ?? {}), DISCORD_STATE_DIR: stateDir };
    writeFileSync(settingsLocal, JSON.stringify(existing, null, 2));
    extraAgentEnv.DISCORD_BOT_TOKEN = secrets.DISCORD_BOT_TOKEN ?? "";
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
  await sh(["claude", "-p", `/claude-code-hermit:hatch ${prompt}`,
    "--permission-mode", "acceptEdits", "--dangerously-skip-permissions",
    "--model", "sonnet", "--output-format", "stream-json", "--verbose"], authEnv);

  // hatch must have produced the session launcher; if not, fail loudly.
  const starter = join(PROJECT, ".claude-code-hermit", "bin", "hermit-start");
  if (!existsSync(starter)) throw new Error("hatch did not create .claude-code-hermit/bin/hermit-start");

  // ---- write the agent EnvironmentFile (host can later rewrite for reseed) ----
  const agentVars: Record<string, string> = {
    ...authEnv, ...extraAgentEnv,
    CLAUDE_CONFIG_DIR: CONFIG_DIR,
    AGENT_HOOK_PROFILE: "standard",
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
```

- [ ] **Step 2: Type-check the orchestrator** (no unit test — it is integration-tested in Task 9; verify it compiles)

Run: `cd guest/bootstrap && bun build main.ts --target=bun --outfile=/dev/null`
Expected: builds with no type/parse errors.

- [ ] **Step 3: Commit**

```bash
git add guest/bootstrap/main.ts
git commit -m "feat: bootstrap orchestrator (pre-seed, plugins, hatch)"
```

---

### Task 4: Two-phase systemd units (`hermit-init` → `hermit-agent`)

**Files:**
- Create: `nix/hermit-services.nix`

**Interfaces:**
- Consumes: `guest/bootstrap/main.ts` + `lib.ts` (copied into the Nix store), the runtime/seed shares and volume, packages from Task 1.
- Produces:
  - `hermit-init.service` — oneshot, `ConditionPathExists=!/var/lib/hermit/.hermit-initialized`, runs the bootstrap via `bun`. `RemainAfterExit=true`.
  - `hermit-agent.service` — `Requires=`/`After=hermit-init.service` + `network-online.target`, `EnvironmentFile=/run/hermit-runtime/agent.env`, `WorkingDirectory=/var/lib/hermit/project`, `ExecStart=.../bin/hermit-start --no-tmux`, `ExecStartPost` writes `status=running`, `Restart=always`.

- [ ] **Step 1: Write `nix/hermit-services.nix`**

```nix
{ pkgs, lib, ... }:
let
  bootstrapSrc = ../guest/bootstrap;   # contains main.ts + lib.ts
  runtimePath = lib.makeBinPath (with pkgs; [ claude-code bun nodejs_22 git gh jq socat coreutils ]);
in {
  systemd.services.hermit-init = {
    description = "Hermit one-time bootstrap (pre-seed + hatch)";
    wantedBy = [ "multi-user.target" ];
    after = [ "local-fs.target" "network-online.target" ];
    wants = [ "network-online.target" ];
    unitConfig.ConditionPathExists = "!/var/lib/hermit/.hermit-initialized";
    environment.PATH = runtimePath;
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
      ExecStart = "${pkgs.bun}/bin/bun run ${bootstrapSrc}/main.ts";
      TimeoutStartSec = "900";
    };
  };

  systemd.services.hermit-agent = {
    description = "Hermit never-ending session";
    wantedBy = [ "multi-user.target" ];
    requires = [ "hermit-init.service" ];
    after = [ "hermit-init.service" "network-online.target" ];
    wants = [ "network-online.target" ];
    environment.PATH = runtimePath;
    serviceConfig = {
      Type = "simple";
      WorkingDirectory = "/var/lib/hermit/project";
      EnvironmentFile = "/run/hermit-runtime/agent.env";
      ExecStart = "/var/lib/hermit/project/.claude-code-hermit/bin/hermit-start --no-tmux";
      ExecStartPost = "${pkgs.coreutils}/bin/sh -c 'printf \"{\\\"phase\\\":\\\"running\\\",\\\"ts\\\":%s}\" $(date +%s) > /run/hermit-runtime/status.json'";
      Restart = "always";
      RestartSec = "10";
    };
  };
}
```

- [ ] **Step 2: Build the full guest to verify both units evaluate and the closure builds**

Run: `nix build .#nixosConfigurations.hermit.config.microvm.declaredRunner --no-link --print-out-paths`
Expected: builds successfully (now includes claude-code, bun, and the bootstrap source). First build will be slow.

- [ ] **Step 3: Commit**

```bash
git add nix/hermit-services.nix
git commit -m "feat: two-phase systemd (hermit-init then hermit-agent)"
```

---

### Task 5: `reseed-auth` command + guest auth-reload path unit

**Files:**
- Create: `cli/src/commands/reseed-auth.ts`
- Modify: `cli/src/index.ts`
- Modify: `nix/hermit-services.nix`
- Test: `cli/test/reseed-auth.test.ts`

**Interfaces:**
- Consumes: `VmPaths` (Plan 1), `parseSecrets` (Plan 1).
- Produces:
  - host command `reseed-auth <name> --secrets <file>` — re-parses the secrets file, recomputes the auth lines, and rewrites **only** the auth keys in `runtime/agent.env` (preserving the non-auth lines), atomically.
  - guest `hermit-auth-reload.path` + `.service` — watches `/run/hermit-runtime/agent.env`; on change, runs `systemctl restart hermit-agent.service`.

- [ ] **Step 1: Write the failing test `cli/test/reseed-auth.test.ts`**

```ts
import { test, expect } from "bun:test";
import { rewriteAuth } from "../src/commands/reseed-auth";

test("rewriteAuth replaces auth keys, preserves others", () => {
  const current = "ANTHROPIC_API_KEY=old\nGH_TOKEN=gh\nDISCORD_BOT_TOKEN=d\n";
  const out = rewriteAuth(current, { CLAUDE_CODE_OAUTH_TOKEN: "new" });
  expect(out).toContain("CLAUDE_CODE_OAUTH_TOKEN=new");
  expect(out).not.toContain("ANTHROPIC_API_KEY=old");
  expect(out).toContain("GH_TOKEN=gh");
  expect(out).toContain("DISCORD_BOT_TOKEN=d");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd cli && bun test test/reseed-auth.test.ts`
Expected: FAIL — cannot find module `../src/commands/reseed-auth`.

- [ ] **Step 3: Write `cli/src/commands/reseed-auth.ts`**

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd cli && bun test test/reseed-auth.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Modify `cli/src/index.ts`** — add `import "./commands/reseed-auth";` with the other command imports.

- [ ] **Step 6: Modify `nix/hermit-services.nix`** — add the path+service that restarts the agent on `agent.env` change

```nix
  systemd.paths.hermit-auth-reload = {
    wantedBy = [ "multi-user.target" ];
    pathConfig.PathModified = "/run/hermit-runtime/agent.env";
  };
  systemd.services.hermit-auth-reload = {
    serviceConfig = {
      Type = "oneshot";
      ExecStart = "${pkgs.systemd}/bin/systemctl restart hermit-agent.service";
    };
  };
```

- [ ] **Step 7: Build the guest to verify it still evaluates**

Run: `nix build .#nixosConfigurations.hermit.config.microvm.declaredRunner --no-link`
Expected: builds successfully.

- [ ] **Step 8: Commit**

```bash
git add cli/src/commands/reseed-auth.ts cli/src/index.ts nix/hermit-services.nix cli/test/reseed-auth.test.ts
git commit -m "feat: reseed-auth with guest auto-restart on agent.env change"
```

---

### Task 6: `--rehatch` (host flag + guest rehatch path unit)

**Files:**
- Modify: `cli/src/commands/up.ts`
- Modify: `nix/hermit-services.nix`
- Test: `cli/test/rehatch.test.ts`

**Interfaces:**
- Consumes: `up` command (Plan 1 / extended in Task 8), `VmPaths`.
- Produces:
  - `up --rehatch` writes a `runtime/rehatch-request` file before launch (or, if the VM is already up, just writes it).
  - guest `hermit-rehatch.path` + `.service` — on `rehatch-request` appearing: delete the marker, `systemctl start hermit-init`, then `systemctl restart hermit-agent`, then delete the request file.
  - exported `wantsRehatch(argv: string[]): boolean` helper for testing.

- [ ] **Step 1: Write the failing test `cli/test/rehatch.test.ts`**

```ts
import { test, expect } from "bun:test";
import { wantsRehatch } from "../src/commands/up";

test("detects --rehatch flag", () => {
  expect(wantsRehatch(["seed.yaml", "--rehatch"])).toBe(true);
  expect(wantsRehatch(["seed.yaml"])).toBe(false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd cli && bun test test/rehatch.test.ts`
Expected: FAIL — `wantsRehatch` is not exported.

- [ ] **Step 3: Modify `cli/src/commands/up.ts`** — export the helper and write the request file when set

Add near the top (after imports):

```ts
export function wantsRehatch(argv: string[]): boolean {
  return argv.includes("--rehatch");
}
```

Inside the `up` handler, immediately after `await renderHostState(paths, seed, secrets);`, add:

```ts
  if (wantsRehatch(argv)) {
    await Bun.write(`${paths.runtime}/rehatch-request`, new Date().toISOString());
    deps.log("rehatch requested; the guest will re-run setup on next boot/now.");
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd cli && bun test test/rehatch.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Modify `nix/hermit-services.nix`** — add the rehatch path+service

```nix
  systemd.paths.hermit-rehatch = {
    wantedBy = [ "multi-user.target" ];
    pathConfig.PathExists = "/run/hermit-runtime/rehatch-request";
  };
  systemd.services.hermit-rehatch = {
    path = [ pkgs.coreutils pkgs.systemd ];
    serviceConfig.Type = "oneshot";
    script = ''
      rm -f /var/lib/hermit/.hermit-initialized
      systemctl start hermit-init.service
      systemctl restart hermit-agent.service
      rm -f /run/hermit-runtime/rehatch-request
    '';
  };
```

- [ ] **Step 6: Build the guest to verify it evaluates**

Run: `nix build .#nixosConfigurations.hermit.config.microvm.declaredRunner --no-link`
Expected: builds successfully.

- [ ] **Step 7: Commit**

```bash
git add cli/src/commands/up.ts nix/hermit-services.nix cli/test/rehatch.test.ts
git commit -m "feat: --rehatch via guest path unit"
```

---

### Task 7: Extend `up` polling + Discord pairing guidance + `status` phases

**Files:**
- Modify: `cli/src/commands/up.ts`
- Modify: `cli/src/commands/status.ts`
- Test: `cli/test/up-target.test.ts`

**Interfaces:**
- Consumes: `pollStatus` (Plan 1), `Seed.channels.discord`.
- Produces:
  - `up` polls until `running` (success) or `awaiting_pairing` (partial success) instead of Plan 1's `ready`; on `running`, if Discord is enabled, prints the one-time pairing instruction.
  - exported `successPhase(s: Status | null): "ok" | "pair" | "fail"` classifier for testing.
  - `status` prints the full phase set and any `.error`.

- [ ] **Step 1: Write the failing test `cli/test/up-target.test.ts`**

```ts
import { test, expect } from "bun:test";
import { successPhase } from "../src/commands/up";

test("classifies phases", () => {
  expect(successPhase({ phase: "running" })).toBe("ok");
  expect(successPhase({ phase: "awaiting_pairing" })).toBe("pair");
  expect(successPhase({ phase: "error", error: "x" })).toBe("fail");
  expect(successPhase(null)).toBe("fail");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd cli && bun test test/up-target.test.ts`
Expected: FAIL — `successPhase` not exported.

- [ ] **Step 3: Modify `cli/src/commands/up.ts`**

Add the classifier near the top:

```ts
import type { Status } from "../status";
export function successPhase(s: Status | null): "ok" | "pair" | "fail" {
  if (s?.phase === "running") return "ok";
  if (s?.phase === "awaiting_pairing") return "pair";
  return "fail";
}
```

Replace the Plan 1 tail (the `pollStatus(paths, "ready", ...)` block) with:

```ts
  deps.log("waiting for the agent to come up (build + bootstrap + hatch can take several minutes)...");
  const s = await pollStatus(paths, "running", 1_200_000); // up to 20 min on first hatch
  const cls = successPhase(s);
  if (cls === "ok") {
    deps.log(`✅ ${seed.name} is running.`);
    if (seed.channels?.discord?.enabled) {
      deps.log("Discord: DM the bot once to pair, then run /discord:access pair <code> in its DM.");
    }
    return 0;
  }
  if (cls === "pair") {
    deps.log(`🔗 ${seed.name} is up but awaiting Discord pairing. DM the bot to complete it.`);
    return 0;
  }
  deps.error(`agent did not reach 'running' (last: ${s?.phase ?? "none"}${s?.error ? ", error: " + s.error : ""}). See: hermit-vm logs ${seed.name}`);
  return 1;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd cli && bun test test/up-target.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Modify `cli/src/commands/status.ts`** — show known phases

Replace the `deps.log(\`phase:  ...\`)` line with:

```ts
  const known = ["auth","channels","plugins","hatching","bootstrapped","running","awaiting_pairing","error"];
  deps.log(`phase:  ${s?.phase ?? "unknown"}${s && !known.includes(s.phase) ? " (?)" : ""}`);
```

- [ ] **Step 6: Run the full suite**

Run: `cd cli && bun test`
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add cli/src/commands/up.ts cli/src/commands/status.ts cli/test/up-target.test.ts
git commit -m "feat: up polls to running; Discord pairing guidance; status phases"
```

---

### Task 8: End-to-end on macOS with real credentials + README/runbook

**Files:**
- Modify: `README.md`
- Create: `docs/runbook.md`

**Interfaces:**
- Consumes: the whole system. No new code.
- Produces: documentation + a verified live agent that checks into Discord.

- [ ] **Step 1: Update `README.md`** — replace the Plan 1 "scope" paragraph with the full feature description

```markdown
Boot an isolated NixOS microVM on macOS (Apple Silicon) via vfkit that runs a
fully-bootstrapped claude-code-hermit agent. On first boot it pre-seeds auth +
plugins + onboarding/trust bypass, runs `/claude-code-hermit:hatch <prompt>`,
then keeps a never-ending session alive via systemd. The agent checks into its
configured Discord channel when ready.

## Commands
- `hermit-vm up <seed.yaml> --secrets <file> [--rehatch]`
- `hermit-vm status <name>` · `logs <name>` · `down <name> [--wipe]`
- `hermit-vm reseed-auth <name> --secrets <file>`  (live auth rotation)
```

- [ ] **Step 2: Write `docs/runbook.md`** (the live verification ritual)

```markdown
# Runbook: deploy a live Hermit

1. Prereqs: aarch64-linux builder OK (`nix build nixpkgs#hello --system aarch64-linux`).
2. Real `seed.yaml` with `channels.discord.enabled: true`, a real `channel_id`,
   `allowed_users`, and a `hatch_prompt` ending in "announce readiness in Discord".
3. Real `secrets.env`: ONE of `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN`,
   plus `DISCORD_BOT_TOKEN` and `GH_TOKEN`.
4. `nix run .#hermit-vm -- up seed.yaml --secrets secrets.env`
   - Watch phases: `hermit-vm status <name>` cycles auth→channels→plugins→hatching→running.
   - Tail detail: `hermit-vm logs <name>`.
5. First-time Discord pairing (interactive, one time): DM the bot; in its DM run
   `/discord:access pair <code>`. Subsequent boots reuse `access.json`.
6. Confirm the agent posts a readiness message in the channel.
7. Rotate auth without downtime: `hermit-vm reseed-auth <name> --secrets new.env`.
8. Re-run setup: `hermit-vm up seed.yaml --secrets secrets.env --rehatch`.
9. Tear down: `hermit-vm down <name>` (keep state) or `--wipe` (delete it).

## Troubleshooting
- `phase: error` → `hermit-vm logs <name>`; common: bad auth, or hatch failed to
  create `bin/hermit-start` (re-run with `--rehatch`).
- Agent crash-looping → check `agent.env` auth validity; `reseed-auth` if expired.
```

- [ ] **Step 3: Perform the live e2e on the Mac**

Run the steps in `docs/runbook.md` with real credentials and a throwaway Discord bot/channel.
Expected: `status` reaches `running`; the bot pairs after one DM; the agent posts a readiness message in the configured channel; `reseed-auth` restarts the agent cleanly; `--rehatch` re-runs setup; `down --wipe` removes everything.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/runbook.md
git commit -m "docs: full README and live deploy runbook"
```

---

## Self-Review (completed)

- **Spec coverage:** Plan 2 implements the spec's two-phase systemd bootstrap, hybrid hatch (deterministic pre-seed + `hatch <prompt>`), both auth paths with the research-corrected token preference, Discord token seeding + pairing handling, the never-ending session via `hermit-start --no-tmux`, the full status-phase protocol, idempotent marker, `reseed-auth`, and `--rehatch`. Combined with Plan 1, the entire design spec is covered. **Still deferred** (explicitly, per spec phasing): the Linux/qemu host branch (iteration 2) and seed-driven VM sizing.
- **Research corrections honored:** only stable/documented artifacts are pre-seeded; `config.json`/`OPERATOR.md`/`bin/hermit-start` are left to `hatch`; `CLAUDE_CODE_OAUTH_TOKEN`/`ANTHROPIC_API_KEY` preferred over copied creds (with a logged warning); Discord pairing treated as the one interactive step (not blocked on).
- **Placeholder scan:** none — every step has concrete code/commands. The two non-unit-tested items (`main.ts`, the Nix units) are explicitly covered by the Task 8 live e2e, with `bun build` type-checking for `main.ts`.
- **Type consistency:** `Status`, `CliDeps`, `VmPaths`, `Seed`, `Secrets` reused from Plan 1; new exports `readEnvFiles`/`resolveAuth`/`claudeJson`/`agentEnvContent` (lib), `rewriteAuth` (reseed-auth), `wantsRehatch`/`successPhase` (up) are each defined once and consumed consistently. In-guest paths (`CLAUDE_CONFIG_DIR`, project, marker, `agent.env`) match between `main.ts` and `hermit-services.nix`.

## Known risks to validate during execution

1. **Headless `hatch` behavior is empirical** — it uses `AskUserQuestion`; in `-p` it falls back to defaults. Task 3 asserts `bin/hermit-start` exists afterward and fails loudly if not; `--rehatch` is the recovery lever. If hatch proves unreliable headless, the fallback is to pre-write a minimal `config.json` from the upstream template (deferred unless needed).
2. **Discord channel state format** is a research preview and may change — we pre-seed only the token and rely on interactive pairing.
3. **`hermit-start --no-tmux` under systemd** — confirm it stays in the foreground (systemd `Type=simple`); if it daemonizes, switch to `Type=forking` or invoke `claude` with the hermit session skill directly.
```
