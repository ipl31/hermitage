# Hermit microVM Deployer — Plan 1: VM Skeleton + Wrapper Lifecycle

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `hermit-vm` CLI and a Nix flake that boot, observe, and cleanly stop an empty NixOS microVM on a macOS host via vfkit — with the persistent state volume and seed/runtime virtiofs shares wired and proven, but no Hermit yet.

**Architecture:** A Nix flake exposes a `vfkit` microVM `nixosConfiguration` whose share/volume/socket paths are **relative**, plus a Bun/TypeScript CLI packaged as `hermit-vm`. The CLI renders a per-VM host state directory, then runs the flake's `declaredRunner` **with its CWD set to that directory** so every relative path resolves there. A trivial in-guest systemd oneshot writes `status.json` to the runtime share, proving the host↔guest plumbing end-to-end. Lifecycle stop uses vfkit's control socket via the generated `microvm-shutdown` script, with a PID kill as fallback.

**Tech Stack:** Nix flakes, microvm.nix (vfkit), NixOS modules + systemd, Bun + TypeScript (CLI + tests), nix-darwin linux-builder (host prerequisite), socat.

## Global Constraints

- Host platform this plan targets: **macOS / `aarch64-darwin`**; guest: **`aarch64-linux`**. (Linux host support is out of scope for this plan.)
- Building the guest **requires an `aarch64-linux` Nix builder** on the mac (e.g. `nix.linux-builder.enable = true;`). The CLI must detect its absence and print remediation — never auto-mutate host config.
- Hypervisor is **`vfkit`**. vfkit supports **virtiofs only** (no 9p), **`type="user"` networking only** (NAT outbound; an interface MUST be declared), and provides a **control socket** (`microvm.socket`) with a generated `bin/microvm-shutdown`.
- vfkit does **not** host-enforce read-only shares; read-only is achieved with a guest mount **option** (advisory).
- All microVM host paths (`microvm.shares.*.source`, `microvm.volumes.*.image`, `microvm.socket`) MUST be **relative** in the Nix config; the CLI sets the runner process CWD to the per-VM state dir so they resolve deterministically.
- Per-VM host state dir: **`~/.local/share/hermit-vm/<name>/`** containing `seed/`, `runtime/`, `state.img`, `hermit.sock`.
- Fixed guest defaults this plan: `vcpu = 2`, `mem = 2048` (MiB), volume `size = 4096` (MiB). Seed-driven sizing is deferred to a later plan.
- The always-works run form is `nix run .#nixosConfigurations.hermit.config.microvm.declaredRunner`; the short alias `nix run .#hermit` requires exporting a package under the **host** system (`aarch64-darwin`).
- `pkgs.claude-code` is **unfree** — any guest that includes it needs `nixpkgs.config.allowUnfree = true` (not needed in this plan; guest stays Hermit-free).
- Secrets file perms: secrets dir `0700`, secret files `0600`.
- Commit after every task. Conventional Commit messages.

---

### Task 1: Repo scaffold + flake with a bootable empty vfkit microVM

**Files:**
- Create: `flake.nix`
- Create: `nix/guest.nix`
- Create: `nix/guest-config.nix`
- Create: `.gitignore`

**Interfaces:**
- Produces: `nixosConfigurations.hermit` (a vfkit microVM, guest `aarch64-linux`); `packages.aarch64-darwin.hermit` (= its `declaredRunner`); `packages.aarch64-darwin.default` placeholder wired in Task 5.
- Consumes: nothing.

- [ ] **Step 1: Write `.gitignore`**

```gitignore
# Nix
result
result-*
.direnv/

# CLI
cli/node_modules/
*.tsbuildinfo

# Local VM state (never commit)
*.img
*.sock
```

- [ ] **Step 2: Write `nix/guest-config.nix`** (the NixOS module for the guest)

```nix
# The guest NixOS configuration for the Hermit microVM.
# In this plan it is intentionally Hermit-free: it only proves the
# host<->guest plumbing by writing a status file to the runtime share.
{ lib, pkgs, hypervisor, ... }:
{
  networking.hostName = "hermit";
  system.stateVersion = "24.11";

  # vfkit requires an explicitly declared user-mode NIC for outbound NAT.
  microvm = {
    inherit hypervisor;
    vcpu = 2;
    mem = 2048;

    # Relative paths resolve against the runner process CWD, which the CLI
    # sets to the per-VM host state dir.
    socket = "hermit.sock";

    interfaces = [{
      type = "user";
      id = "eth0";
      mac = "02:00:00:00:00:01";
    }];

    shares = [
      {
        proto = "virtiofs";
        tag = "hermit-seed";
        source = "seed";            # ~/.local/share/hermit-vm/<name>/seed
        mountPoint = "/run/hermit-seed";
      }
      {
        proto = "virtiofs";
        tag = "hermit-runtime";
        source = "runtime";         # ~/.local/share/hermit-vm/<name>/runtime
        mountPoint = "/run/hermit-runtime";
      }
    ];

    volumes = [{
      image = "state.img";          # ~/.local/share/hermit-vm/<name>/state.img
      mountPoint = "/var/lib/hermit";
      size = 4096;
      autoCreate = true;
      fsType = "ext4";
    }];
  };

  # Advisory read-only mount for the seed share (vfkit does not host-enforce).
  fileSystems."/run/hermit-seed".options = lib.mkForce [ "ro" "nofail" ];

  networking.useDHCP = lib.mkDefault true;
}
```

- [ ] **Step 3: Write `nix/guest.nix`** (function building the nixosSystem)

```nix
# Builds the guest nixosSystem. Parameterized by hypervisor so a later plan
# can target qemu on Linux without touching guest-config.nix.
{ nixpkgs, microvm, guestSystem, hypervisor }:
nixpkgs.lib.nixosSystem {
  system = guestSystem;
  specialArgs = { inherit hypervisor; };
  modules = [
    microvm.nixosModules.microvm
    ./guest-config.nix
  ];
}
```

- [ ] **Step 4: Write `flake.nix`**

```nix
{
  description = "Hermit microVM deployer";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
    microvm.url = "github:microvm-nix/microvm.nix";
    microvm.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = { self, nixpkgs, microvm }:
    let
      hostSystem = "aarch64-darwin";
      guestSystem = "aarch64-linux";
      pkgs = nixpkgs.legacyPackages.${hostSystem};
    in {
      nixosConfigurations.hermit = import ./nix/guest.nix {
        inherit nixpkgs microvm guestSystem;
        hypervisor = "vfkit";
      };

      packages.${hostSystem} = {
        hermit = self.nixosConfigurations.hermit.config.microvm.declaredRunner;
        # `hermit-vm` and `default` are wired in Task 5.
      };
    };
}
```

- [ ] **Step 5: Evaluate the flake to verify it parses and the config resolves**

Run: `nix flake show`
Expected: output lists `nixosConfigurations.hermit` and `packages.aarch64-darwin.hermit`. No evaluation errors.

- [ ] **Step 6: Verify a Linux builder is present, then build the runner**

Run: `nix build nixpkgs#hello --system aarch64-linux --no-link`
Expected: succeeds (proves the linux-builder works). If it fails, set up `nix.linux-builder.enable = true;` first — this is the prerequisite Task 4 will codify in preflight.

Run: `nix build .#nixosConfigurations.hermit.config.microvm.declaredRunner --no-link --print-out-paths`
Expected: prints a `/nix/store/...-microvm-run` path. Build succeeds.

- [ ] **Step 7: Commit**

```bash
git add flake.nix flake.lock nix/ .gitignore
git commit -m "feat: bootable empty vfkit microVM flake"
```

---

### Task 2: CLI scaffold (Bun + TypeScript) with subcommand routing

**Files:**
- Create: `cli/package.json`
- Create: `cli/tsconfig.json`
- Create: `cli/src/index.ts`
- Create: `cli/src/cli.ts`
- Test: `cli/test/cli.test.ts`

**Interfaces:**
- Produces: `runCli(argv: string[], deps: CliDeps): Promise<number>` in `cli/src/cli.ts`, returning a process exit code. `CliDeps` is the injectable dependency bag (filesystem, command runner, logger) defined here and extended by later tasks.
- Consumes: nothing.

- [ ] **Step 1: Write `cli/package.json`**

```json
{
  "name": "hermit-vm",
  "version": "0.1.0",
  "type": "module",
  "bin": { "hermit-vm": "./src/index.ts" },
  "devDependencies": { "@types/bun": "latest" },
  "dependencies": { "yaml": "^2.5.0" }
}
```

- [ ] **Step 2: Write `cli/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["bun-types"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true
  }
}
```

- [ ] **Step 3: Write the failing test `cli/test/cli.test.ts`**

```ts
import { test, expect } from "bun:test";
import { runCli, type CliDeps } from "../src/cli";

function fakeDeps(overrides: Partial<CliDeps> = {}): CliDeps {
  return {
    log: () => {},
    error: () => {},
    run: async () => ({ code: 0, stdout: "", stderr: "" }),
    ...overrides,
  };
}

test("unknown command returns exit code 2 and prints usage", async () => {
  const lines: string[] = [];
  const code = await runCli(["bogus"], fakeDeps({ error: (m) => lines.push(m) }));
  expect(code).toBe(2);
  expect(lines.join("\n")).toContain("usage: hermit-vm");
});

test("no command prints usage and returns 2", async () => {
  const code = await runCli([], fakeDeps());
  expect(code).toBe(2);
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd cli && bun test test/cli.test.ts`
Expected: FAIL — cannot find module `../src/cli`.

- [ ] **Step 5: Write `cli/src/cli.ts`**

```ts
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
```

- [ ] **Step 6: Write `cli/src/index.ts`** (the real entry point binding `CliDeps` to the OS)

```ts
#!/usr/bin/env bun
import { runCli, type CliDeps } from "./cli";

const deps: CliDeps = {
  log: (m) => console.log(m),
  error: (m) => console.error(m),
  run: async (cmd, args, opts) => {
    const proc = Bun.spawn([cmd, ...args], {
      cwd: opts?.cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const code = await proc.exited;
    return { code, stdout, stderr };
  },
};

process.exit(await runCli(process.argv.slice(2), deps));
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd cli && bun test test/cli.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add cli/
git commit -m "feat: hermit-vm CLI scaffold with subcommand routing"
```

---

### Task 3: Seed + secrets parsing and validation

**Files:**
- Create: `cli/src/seed.ts`
- Create: `cli/src/secrets.ts`
- Test: `cli/test/seed.test.ts`
- Test: `cli/test/secrets.test.ts`
- Create: `docs/seed.example.yaml`
- Create: `docs/secrets.example.env`

**Interfaces:**
- Produces:
  - `parseSeed(text: string): Seed` where `interface Seed { name: string; agent_name: string; timezone: string; channels?: { discord?: { enabled: boolean; channel_id: string; allowed_users?: string[]; morning_brief?: string } }; routines?: unknown[]; hatch_prompt?: string; secrets_file?: string }`. Throws `SeedError` (a subclass of `Error`) on missing/invalid `name`, `agent_name`, or `timezone`.
  - `parseSecrets(text: string): Secrets` where `interface Secrets { env: Record<string,string>; authMode: "apikey" | "oauth-token" | "oauth-creds" }`. Throws `SecretsError` unless exactly one Claude auth source is present.
- Consumes: nothing (pure string→object).

- [ ] **Step 1: Write the failing test `cli/test/seed.test.ts`**

```ts
import { test, expect } from "bun:test";
import { parseSeed, SeedError } from "../src/seed";

const valid = `
name: my-hermit
agent_name: Hermit
timezone: America/New_York
channels:
  discord:
    enabled: true
    channel_id: "123"
    allowed_users: ["456"]
hatch_prompt: "set yourself up"
`;

test("parses a valid seed", () => {
  const s = parseSeed(valid);
  expect(s.name).toBe("my-hermit");
  expect(s.channels?.discord?.channel_id).toBe("123");
  expect(s.hatch_prompt).toBe("set yourself up");
});

test("rejects a seed missing required fields", () => {
  expect(() => parseSeed("agent_name: x")).toThrow(SeedError);
});

test("rejects a name that is not a safe directory token", () => {
  expect(() => parseSeed("name: ../evil\nagent_name: x\ntimezone: UTC")).toThrow(SeedError);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd cli && bun test test/seed.test.ts`
Expected: FAIL — cannot find module `../src/seed`.

- [ ] **Step 3: Write `cli/src/seed.ts`**

```ts
import { parse } from "yaml";

export class SeedError extends Error {}

export interface DiscordChannel {
  enabled: boolean;
  channel_id: string;
  allowed_users?: string[];
  morning_brief?: string;
}
export interface Seed {
  name: string;
  agent_name: string;
  timezone: string;
  channels?: { discord?: DiscordChannel };
  routines?: unknown[];
  hatch_prompt?: string;
  secrets_file?: string;
}

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function parseSeed(text: string): Seed {
  let raw: unknown;
  try { raw = parse(text); } catch (e) { throw new SeedError(`invalid YAML: ${e}`); }
  if (typeof raw !== "object" || raw === null) throw new SeedError("seed must be a mapping");
  const o = raw as Record<string, unknown>;

  const req = (k: string): string => {
    const v = o[k];
    if (typeof v !== "string" || v.length === 0) throw new SeedError(`missing required field: ${k}`);
    return v;
  };

  const name = req("name");
  if (!NAME_RE.test(name)) throw new SeedError(`name must match ${NAME_RE} (got '${name}')`);

  return {
    name,
    agent_name: req("agent_name"),
    timezone: req("timezone"),
    channels: o.channels as Seed["channels"],
    routines: Array.isArray(o.routines) ? o.routines : undefined,
    hatch_prompt: typeof o.hatch_prompt === "string" ? o.hatch_prompt : undefined,
    secrets_file: typeof o.secrets_file === "string" ? o.secrets_file : undefined,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd cli && bun test test/seed.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing test `cli/test/secrets.test.ts`**

```ts
import { test, expect } from "bun:test";
import { parseSecrets, SecretsError } from "../src/secrets";

test("parses an env file with an API key", () => {
  const s = parseSecrets("ANTHROPIC_API_KEY=sk-ant-x\nDISCORD_BOT_TOKEN=tok\n# comment\n");
  expect(s.authMode).toBe("apikey");
  expect(s.env.DISCORD_BOT_TOKEN).toBe("tok");
});

test("detects an oauth token", () => {
  expect(parseSecrets("CLAUDE_CODE_OAUTH_TOKEN=abc").authMode).toBe("oauth-token");
});

test("rejects zero auth sources", () => {
  expect(() => parseSecrets("DISCORD_BOT_TOKEN=tok")).toThrow(SecretsError);
});

test("rejects two auth sources", () => {
  expect(() => parseSecrets("ANTHROPIC_API_KEY=a\nCLAUDE_CODE_OAUTH_TOKEN=b")).toThrow(SecretsError);
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd cli && bun test test/secrets.test.ts`
Expected: FAIL — cannot find module `../src/secrets`.

- [ ] **Step 7: Write `cli/src/secrets.ts`**

```ts
export class SecretsError extends Error {}

export type AuthMode = "apikey" | "oauth-token" | "oauth-creds";
export interface Secrets { env: Record<string, string>; authMode: AuthMode; }

export function parseSecrets(text: string): Secrets {
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) throw new SecretsError(`invalid line (no '='): ${t}`);
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }

  const sources: AuthMode[] = [];
  if (env.ANTHROPIC_API_KEY) sources.push("apikey");
  if (env.CLAUDE_CODE_OAUTH_TOKEN) sources.push("oauth-token");
  if (env.CLAUDE_OAUTH_CREDS) sources.push("oauth-creds");
  if (sources.length === 0) {
    throw new SecretsError("no Claude auth: set one of ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN, CLAUDE_OAUTH_CREDS");
  }
  if (sources.length > 1) {
    throw new SecretsError(`multiple Claude auth sources (${sources.join(", ")}); set exactly one`);
  }
  return { env, authMode: sources[0]! };
}
```

- [ ] **Step 8: Run the secrets test to verify it passes**

Run: `cd cli && bun test test/secrets.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 9: Write `docs/seed.example.yaml` and `docs/secrets.example.env`**

```yaml
# docs/seed.example.yaml
name: my-hermit                 # VM + state-dir name ([a-z0-9-], <=63 chars)
agent_name: Hermit
timezone: America/New_York
channels:
  discord:
    enabled: true
    channel_id: "123456789012345678"
    allowed_users: ["234567890123456789"]
    morning_brief: "07:00"
routines: []
hatch_prompt: |
  Set yourself up as a helpful dev assistant for this project.
  Use balanced escalation. Announce readiness in Discord when ready.
secrets_file: ./secrets.env
```

```sh
# docs/secrets.example.env  (gitignored in real use)
# Exactly ONE Claude auth source:
ANTHROPIC_API_KEY=sk-ant-...
# CLAUDE_CODE_OAUTH_TOKEN=...        # from `claude setup-token` (robust for long-running)
# CLAUDE_OAUTH_CREDS=./creds.json    # path to a captured .credentials.json (may not auto-refresh)

DISCORD_BOT_TOKEN=...
GH_TOKEN=...
```

- [ ] **Step 10: Commit**

```bash
git add cli/src/seed.ts cli/src/secrets.ts cli/test/seed.test.ts cli/test/secrets.test.ts docs/
git commit -m "feat: seed and secrets parsing with validation"
```

---

### Task 4: Preflight checks

**Files:**
- Create: `cli/src/preflight.ts`
- Test: `cli/test/preflight.test.ts`

**Interfaces:**
- Consumes: `CliDeps.run` from Task 2.
- Produces: `preflight(deps: CliDeps): Promise<{ ok: boolean; problems: string[] }>`. Checks: (a) `nix` present with flakes enabled, (b) an `aarch64-linux` builder available, (c) `vfkit` resolvable via Nix. Returns all problems with remediation text; does not exit.

- [ ] **Step 1: Write the failing test `cli/test/preflight.test.ts`**

```ts
import { test, expect } from "bun:test";
import { preflight } from "../src/preflight";
import type { CliDeps, RunResult } from "../src/cli";

function depsFor(table: Record<string, RunResult>): CliDeps {
  return {
    log: () => {}, error: () => {},
    run: async (cmd, args) => {
      const key = [cmd, ...args].join(" ");
      for (const [prefix, res] of Object.entries(table)) {
        if (key.startsWith(prefix)) return res;
      }
      return { code: 127, stdout: "", stderr: "not found" };
    },
  };
}
const ok: RunResult = { code: 0, stdout: "", stderr: "" };
const fail: RunResult = { code: 1, stdout: "", stderr: "boom" };

test("all good -> ok", async () => {
  const r = await preflight(depsFor({
    "nix --version": { code: 0, stdout: "nix (Nix) 2.24", stderr: "" },
    "nix build nixpkgs#hello --system aarch64-linux": ok,
    "nix build nixpkgs#vfkit": ok,
  }));
  expect(r.ok).toBe(true);
  expect(r.problems).toHaveLength(0);
});

test("missing linux-builder -> problem with remediation", async () => {
  const r = await preflight(depsFor({
    "nix --version": { code: 0, stdout: "nix (Nix) 2.24", stderr: "" },
    "nix build nixpkgs#hello --system aarch64-linux": fail,
    "nix build nixpkgs#vfkit": ok,
  }));
  expect(r.ok).toBe(false);
  expect(r.problems.join("\n")).toContain("nix.linux-builder.enable");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd cli && bun test test/preflight.test.ts`
Expected: FAIL — cannot find module `../src/preflight`.

- [ ] **Step 3: Write `cli/src/preflight.ts`**

```ts
import type { CliDeps } from "./cli";

export async function preflight(deps: CliDeps): Promise<{ ok: boolean; problems: string[] }> {
  const problems: string[] = [];

  const nix = await deps.run("nix", ["--version"]);
  if (nix.code !== 0) {
    problems.push("nix not found. Install Nix (https://nixos.org/download) with flakes enabled.");
    return { ok: false, problems }; // nothing else will work without nix
  }

  const builder = await deps.run("nix", ["build", "nixpkgs#hello", "--system", "aarch64-linux", "--no-link"]);
  if (builder.code !== 0) {
    problems.push(
      "No aarch64-linux builder available (needed to build the Linux guest from macOS).\n" +
      "Fix one of:\n" +
      "  A) nix-darwin: set `nix.linux-builder.enable = true;` then `darwin-rebuild switch`.\n" +
      "  B) Determinate Nix: enable its built-in Linux builder.\n" +
      "  C) Add the github:cpick/nix-rosetta-builder module.\n" +
      "Verify with: nix build nixpkgs#hello --system aarch64-linux"
    );
  }

  const vfkit = await deps.run("nix", ["build", "nixpkgs#vfkit", "--no-link"]);
  if (vfkit.code !== 0) {
    problems.push("vfkit could not be realised via Nix (`nix build nixpkgs#vfkit`). Check your nixpkgs/network.");
  }

  return { ok: problems.length === 0, problems };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd cli && bun test test/preflight.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add cli/src/preflight.ts cli/test/preflight.test.ts
git commit -m "feat: preflight checks for nix, linux-builder, vfkit"
```

---

### Task 5: Host state-dir paths + rendering + package the CLI in the flake

**Files:**
- Create: `cli/src/state.ts`
- Create: `cli/src/render.ts`
- Test: `cli/test/render.test.ts`
- Create: `cli/package.nix`
- Modify: `flake.nix`

**Interfaces:**
- Consumes: `Seed` (Task 3), `Secrets` (Task 3).
- Produces:
  - `stateDir(name: string, home: string): VmPaths` where `interface VmPaths { root: string; seed: string; runtime: string; image: string; socket: string; statusFile: string; logFile: string }`. `root = <home>/.local/share/hermit-vm/<name>`.
  - `renderHostState(paths: VmPaths, seed: Seed, secrets: Secrets): Promise<void>` — creates `root`, `seed/`, `runtime/`; writes `seed/config.json` (non-secret), `seed/secrets/*` with perms (dir `0700`, files `0600`); leaves `runtime/` empty; is idempotent (safe to re-run, preserves `image`).
  - Exposes `packages.aarch64-darwin.hermit-vm` and `.default` runnable via `nix run`.

- [ ] **Step 1: Write the failing test `cli/test/render.test.ts`**

```ts
import { test, expect } from "bun:test";
import { mkdtempSync, statSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stateDir } from "../src/state";
import { renderHostState } from "../src/render";
import { parseSeed } from "../src/seed";
import { parseSecrets } from "../src/secrets";

test("renders config.json and secrets with correct perms", async () => {
  const home = mkdtempSync(join(tmpdir(), "hv-"));
  const paths = stateDir("my-hermit", home);
  const seed = parseSeed("name: my-hermit\nagent_name: Hermit\ntimezone: UTC\nhatch_prompt: hi");
  const secrets = parseSecrets("ANTHROPIC_API_KEY=sk-ant-x\nDISCORD_BOT_TOKEN=tok");

  await renderHostState(paths, seed, secrets);

  expect(paths.root).toBe(join(home, ".local/share/hermit-vm/my-hermit"));
  expect(existsSync(paths.runtime)).toBe(true);

  const cfg = JSON.parse(readFileSync(join(paths.seed, "config.json"), "utf8"));
  expect(cfg.agent_name).toBe("Hermit");
  expect(cfg.hatch_prompt).toBe("hi");
  expect(cfg.anthropic_api_key).toBeUndefined(); // secrets never in config.json

  const secDir = join(paths.seed, "secrets");
  expect(statSync(secDir).mode & 0o777).toBe(0o700);
  expect(statSync(join(secDir, "anthropic.env")).mode & 0o777).toBe(0o600);
  expect(readFileSync(join(secDir, "discord.env"), "utf8")).toContain("DISCORD_BOT_TOKEN=tok");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd cli && bun test test/render.test.ts`
Expected: FAIL — cannot find module `../src/state`.

- [ ] **Step 3: Write `cli/src/state.ts`**

```ts
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
```

- [ ] **Step 4: Write `cli/src/render.ts`**

```ts
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
```

- [ ] **Step 5: Run the render test to verify it passes**

Run: `cd cli && bun test test/render.test.ts`
Expected: PASS (1 test).

- [ ] **Step 6: Write `cli/package.nix`** (package the CLI as `hermit-vm`)

```nix
{ writeShellApplication, bun, nix, socat, coreutils }:
writeShellApplication {
  name = "hermit-vm";
  runtimeInputs = [ bun nix socat coreutils ];
  text = ''
    exec ${bun}/bin/bun run ${./src/index.ts} "$@"
  '';
}
```

- [ ] **Step 7: Modify `flake.nix`** to expose the CLI package and default app

Replace the `packages.${hostSystem}` attrset with:

```nix
      packages.${hostSystem} = {
        hermit = self.nixosConfigurations.hermit.config.microvm.declaredRunner;
        hermit-vm = pkgs.callPackage ./cli/package.nix { };
        default = self.packages.${hostSystem}.hermit-vm;
      };

      apps.${hostSystem}.default = {
        type = "app";
        program = "${self.packages.${hostSystem}.hermit-vm}/bin/hermit-vm";
      };
```

- [ ] **Step 8: Verify the packaged CLI runs**

Run: `nix run .#hermit-vm -- ` (no args)
Expected: prints `usage: hermit-vm ...` and exits non-zero (exit 2).

- [ ] **Step 9: Commit**

```bash
git add cli/src/state.ts cli/src/render.ts cli/test/render.test.ts cli/package.nix flake.nix
git commit -m "feat: host state rendering and packaged hermit-vm CLI"
```

---

### Task 6: Guest status-writer service (proves host↔guest plumbing)

**Files:**
- Modify: `nix/guest-config.nix`
- Create: `nix/status-writer.nix`

**Interfaces:**
- Produces: an in-guest systemd oneshot `hermit-status.service` that, on boot, reads `/run/hermit-seed/config.json`, confirms `/var/lib/hermit` is writable, and writes `/run/hermit-runtime/status.json` = `{"phase":"ready","name":"<from config>","ts":<unix>}` plus a line to `/run/hermit-runtime/hermit.log`. This is the placeholder the Plan 2 bootstrap/agent services will replace.
- Consumes: the `hermit-seed` and `hermit-runtime` shares and the `/var/lib/hermit` volume from Task 1.

- [ ] **Step 1: Write `nix/status-writer.nix`**

```nix
# Placeholder service for Plan 1: proves the seed share is readable, the
# runtime share is writable, and the persistent volume is mounted.
# Plan 2 replaces this with hermit-init + hermit-agent.
{ pkgs, lib, ... }:
{
  systemd.services.hermit-status = {
    description = "Hermit status writer (plumbing proof)";
    wantedBy = [ "multi-user.target" ];
    after = [ "local-fs.target" ];
    serviceConfig = { Type = "oneshot"; RemainAfterExit = true; };
    path = [ pkgs.coreutils pkgs.jq ];
    script = ''
      set -euo pipefail
      seed=/run/hermit-seed/config.json
      out=/run/hermit-runtime
      log="$out/hermit.log"

      name="unknown"
      if [ -r "$seed" ]; then name="$(jq -r '.name // "unknown"' "$seed")"; fi

      # Prove the persistent volume is writable.
      touch /var/lib/hermit/.plan1-volume-ok

      ts="$(date +%s)"
      printf '{"phase":"ready","name":"%s","ts":%s}\n' "$name" "$ts" > "$out/status.json"
      echo "[$ts] hermit-status: ready (name=$name)" >> "$log"
    '';
  };
}
```

- [ ] **Step 2: Modify `nix/guest-config.nix`** to import the status writer

Add to the top of the module (after the function header), inside the attrset, an `imports` list:

```nix
  imports = [ ./status-writer.nix ];
```

- [ ] **Step 3: Build the guest to verify it still evaluates and builds**

Run: `nix build .#nixosConfigurations.hermit.config.microvm.declaredRunner --no-link --print-out-paths`
Expected: builds successfully and prints a store path.

- [ ] **Step 4: Commit**

```bash
git add nix/status-writer.nix nix/guest-config.nix
git commit -m "feat: guest status-writer service proving host<->guest plumbing"
```

---

### Task 7: VM lifecycle module (build, launch, stop) + status reader

**Files:**
- Create: `cli/src/vm.ts`
- Create: `cli/src/status.ts`
- Test: `cli/test/vm.test.ts`
- Test: `cli/test/status.test.ts`

**Interfaces:**
- Consumes: `CliDeps` (Task 2), `VmPaths` (Task 5).
- Produces:
  - `buildRunner(deps: CliDeps): Promise<string>` — runs `nix build .#nixosConfigurations.hermit.config.microvm.declaredRunner --no-link --print-out-paths`, returns the store path of the runner dir. Throws on failure.
  - `launchVm(deps, runnerPath, paths): Promise<number>` — spawns `<runnerPath>/bin/microvm-run` with `cwd = paths.root`, detached, stdout/stderr appended to `paths.logFile`; writes the child PID to `<paths.root>/vm.pid`; returns the PID.
  - `stopVm(deps, runnerPath, paths): Promise<void>` — runs `<runnerPath>/bin/microvm-shutdown` (socat to the control socket) with `cwd = paths.root`; if that fails or the process is still alive after a timeout, `kill` the PID from `vm.pid`.
  - `readStatus(paths): Promise<{ phase: string; name?: string; ts?: number } | null>` — parses `runtime/status.json`, or `null` if absent/unparseable.
  - `pollStatus(paths, until, timeoutMs): Promise<Status | null>` — polls `readStatus` until `phase === until` or timeout.

- [ ] **Step 1: Write the failing test `cli/test/status.test.ts`**

```ts
import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stateDir } from "../src/state";
import { readStatus, pollStatus } from "../src/status";

test("readStatus returns null when missing", async () => {
  const home = mkdtempSync(join(tmpdir(), "hv-"));
  expect(await readStatus(stateDir("x", home))).toBeNull();
});

test("readStatus parses status.json", async () => {
  const home = mkdtempSync(join(tmpdir(), "hv-"));
  const p = stateDir("x", home);
  mkdirSync(p.runtime, { recursive: true });
  writeFileSync(p.statusFile, JSON.stringify({ phase: "ready", name: "x", ts: 1 }));
  const s = await readStatus(p);
  expect(s?.phase).toBe("ready");
});

test("pollStatus resolves when target phase appears", async () => {
  const home = mkdtempSync(join(tmpdir(), "hv-"));
  const p = stateDir("x", home);
  mkdirSync(p.runtime, { recursive: true });
  setTimeout(() => writeFileSync(p.statusFile, JSON.stringify({ phase: "ready" })), 50);
  const s = await pollStatus(p, "ready", 2000);
  expect(s?.phase).toBe("ready");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd cli && bun test test/status.test.ts`
Expected: FAIL — cannot find module `../src/status`.

- [ ] **Step 3: Write `cli/src/status.ts`**

```ts
import { readFile } from "node:fs/promises";
import type { VmPaths } from "./state";

export interface Status { phase: string; name?: string; ts?: number; error?: string; }

export async function readStatus(paths: VmPaths): Promise<Status | null> {
  try {
    const txt = await readFile(paths.statusFile, "utf8");
    return JSON.parse(txt) as Status;
  } catch { return null; }
}

export async function pollStatus(paths: VmPaths, until: string, timeoutMs: number): Promise<Status | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await readStatus(paths);
    if (s && (s.phase === until || s.phase === "error")) return s;
    await new Promise((r) => setTimeout(r, 500));
  }
  return readStatus(paths);
}
```

- [ ] **Step 4: Run the status test to verify it passes**

Run: `cd cli && bun test test/status.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing test `cli/test/vm.test.ts`** (build command shape only; launch/stop are exercised in the e2e of Task 9)

```ts
import { test, expect } from "bun:test";
import { buildRunner } from "../src/vm";
import type { CliDeps } from "../src/cli";

test("buildRunner invokes nix build of the declaredRunner and returns the path", async () => {
  let seen = "";
  const deps: CliDeps = {
    log: () => {}, error: () => {},
    run: async (cmd, args) => {
      seen = [cmd, ...args].join(" ");
      return { code: 0, stdout: "/nix/store/abc-microvm-run\n", stderr: "" };
    },
  };
  const path = await buildRunner(deps);
  expect(seen).toContain("nix build .#nixosConfigurations.hermit.config.microvm.declaredRunner");
  expect(seen).toContain("--print-out-paths");
  expect(path).toBe("/nix/store/abc-microvm-run");
});

test("buildRunner throws on nix failure", async () => {
  const deps: CliDeps = {
    log: () => {}, error: () => {},
    run: async () => ({ code: 1, stdout: "", stderr: "eval error" }),
  };
  await expect(buildRunner(deps)).rejects.toThrow("eval error");
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd cli && bun test test/vm.test.ts`
Expected: FAIL — cannot find module `../src/vm`.

- [ ] **Step 7: Write `cli/src/vm.ts`**

```ts
import { writeFile, readFile, appendFile } from "node:fs/promises";
import { openSync } from "node:fs";
import { join } from "node:path";
import type { CliDeps } from "./cli";
import type { VmPaths } from "./state";

const RUNNER_ATTR = ".#nixosConfigurations.hermit.config.microvm.declaredRunner";

export async function buildRunner(deps: CliDeps): Promise<string> {
  const r = await deps.run("nix", ["build", RUNNER_ATTR, "--no-link", "--print-out-paths"]);
  if (r.code !== 0) throw new Error(`nix build failed: ${r.stderr.trim()}`);
  const path = r.stdout.trim().split("\n").pop()!;
  if (!path) throw new Error("nix build produced no output path");
  return path;
}

export async function launchVm(_deps: CliDeps, runnerPath: string, paths: VmPaths): Promise<number> {
  const logFd = openSync(paths.logFile, "a");
  const proc = Bun.spawn([join(runnerPath, "bin", "microvm-run")], {
    cwd: paths.root,
    stdout: logFd,
    stderr: logFd,
    stdin: "ignore",
  });
  proc.unref();
  await writeFile(join(paths.root, "vm.pid"), String(proc.pid));
  return proc.pid;
}

export async function stopVm(deps: CliDeps, runnerPath: string, paths: VmPaths): Promise<void> {
  const shutdown = join(runnerPath, "bin", "microvm-shutdown");
  const r = await deps.run(shutdown, [], { cwd: paths.root });
  if (r.code === 0) { await appendFile(paths.logFile, "[hermit-vm] graceful shutdown sent\n"); return; }
  // Fallback: kill the recorded PID.
  try {
    const pid = parseInt(await readFile(join(paths.root, "vm.pid"), "utf8"), 10);
    if (pid > 0) process.kill(pid, "SIGTERM");
  } catch { /* already gone */ }
}
```

- [ ] **Step 8: Run the vm test to verify it passes**

Run: `cd cli && bun test test/vm.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
git add cli/src/vm.ts cli/src/status.ts cli/test/vm.test.ts cli/test/status.test.ts
git commit -m "feat: VM build/launch/stop lifecycle and status reader"
```

---

### Task 8: Wire `up`, `status`, `logs`, `down` commands

**Files:**
- Create: `cli/src/commands/up.ts`
- Create: `cli/src/commands/status.ts`
- Create: `cli/src/commands/logs.ts`
- Create: `cli/src/commands/down.ts`
- Modify: `cli/src/index.ts`
- Test: `cli/test/commands.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–7.
- Produces: registered commands `up`, `status`, `logs`, `down` on the `commands` registry. `up <seed.yaml> [--secrets <file>]` runs preflight → parse → render → ensure volume → build → launch → poll until `ready` → report. `down [name] [--wipe]` stops and (with `--wipe`) deletes the state dir after confirmation.

- [ ] **Step 1: Write the failing test `cli/test/commands.test.ts`** (arg-level: `up` requires a seed path)

```ts
import { test, expect } from "bun:test";
import { runCli, type CliDeps } from "../src/cli";
import "../src/commands/up";        // registers the command
import "../src/commands/status";
import "../src/commands/logs";
import "../src/commands/down";

const noop: CliDeps = {
  log: () => {}, error: () => {},
  run: async () => ({ code: 0, stdout: "", stderr: "" }),
};

test("up with no seed path errors", async () => {
  const errs: string[] = [];
  const code = await runCli(["up"], { ...noop, error: (m) => errs.push(m) });
  expect(code).toBe(2);
  expect(errs.join("\n")).toContain("up: missing <seed.yaml>");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd cli && bun test test/commands.test.ts`
Expected: FAIL — cannot find module `../src/commands/up`.

- [ ] **Step 3: Write `cli/src/commands/up.ts`**

```ts
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

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

registerCommand("up", async (argv: string[], deps: CliDeps): Promise<number> => {
  const seedPath = argv.find((a) => !a.startsWith("--") && a !== flag(argv, "--secrets"));
  if (!seedPath) { deps.error("up: missing <seed.yaml>"); return 2; }

  const pf = await preflight(deps);
  if (!pf.ok) { deps.error("preflight failed:\n" + pf.problems.join("\n\n")); return 1; }

  const seed = parseSeed(await readFile(seedPath, "utf8"));
  const secretsPath = flag(argv, "--secrets")
    ?? (seed.secrets_file ? resolve(dirname(seedPath), seed.secrets_file) : undefined);
  if (!secretsPath || !existsSync(secretsPath)) { deps.error("up: secrets file not found"); return 1; }
  const secrets = parseSecrets(await readFile(secretsPath, "utf8"));

  const paths = stateDir(seed.name, homedir());
  deps.log(`rendering host state at ${paths.root}`);
  await renderHostState(paths, seed, secrets);

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
```

- [ ] **Step 4: Write `cli/src/commands/status.ts`**

```ts
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
  deps.log(`phase:  ${s?.phase ?? "unknown"}`);
  if (s?.error) deps.log(`error:  ${s.error}`);
  return 0;
});
```

- [ ] **Step 5: Write `cli/src/commands/logs.ts`**

```ts
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
```

- [ ] **Step 6: Write `cli/src/commands/down.ts`**

```ts
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
    deps.log(`wiping state at ${paths.root}`);
    await rm(paths.root, { recursive: true, force: true });
    deps.log("state deleted.");
  }
  return 0;
});
```

- [ ] **Step 7: Modify `cli/src/index.ts`** to import the command modules (so they self-register)

Add these imports immediately after the existing `import { runCli, ... }` line:

```ts
import "./commands/up";
import "./commands/status";
import "./commands/logs";
import "./commands/down";
```

- [ ] **Step 8: Run the commands test to verify it passes**

Run: `cd cli && bun test test/commands.test.ts`
Expected: PASS (1 test).

- [ ] **Step 9: Run the full suite**

Run: `cd cli && bun test`
Expected: all tests across all files PASS.

- [ ] **Step 10: Commit**

```bash
git add cli/src/commands/ cli/src/index.ts cli/test/commands.test.ts
git commit -m "feat: wire up/status/logs/down commands"
```

---

### Task 9: End-to-end smoke test on macOS + README

**Files:**
- Create: `README.md`
- Create: `docs/manual-e2e.md`

**Interfaces:**
- Consumes: the whole CLI + flake.
- Produces: documentation + a verified real-hardware run. No new code.

- [ ] **Step 1: Write `README.md`**

````markdown
# Hermit microVM Deployer

Boot an isolated NixOS microVM on macOS (Apple Silicon) via vfkit, managed by a
single `hermit-vm` CLI. **Plan 1 scope:** an empty (Hermit-free) VM that proves
the full host↔guest plumbing. Hermit itself lands in Plan 2.

## Prerequisites
- macOS on Apple Silicon, Nix with flakes enabled.
- An `aarch64-linux` builder (e.g. nix-darwin `nix.linux-builder.enable = true;`).
  Verify: `nix build nixpkgs#hello --system aarch64-linux`

## Usage
```bash
nix run .#hermit-vm -- up docs/seed.example.yaml --secrets docs/secrets.example.env
nix run .#hermit-vm -- status my-hermit
nix run .#hermit-vm -- logs my-hermit
nix run .#hermit-vm -- down my-hermit --wipe
```

State lives under `~/.local/share/hermit-vm/<name>/`.
````

- [ ] **Step 2: Write `docs/manual-e2e.md`** (the exact manual verification ritual)

```markdown
# Manual end-to-end (macOS, Apple Silicon)

1. Confirm the builder: `nix build nixpkgs#hello --system aarch64-linux`
2. Create a real secrets file `./secrets.env` with `ANTHROPIC_API_KEY=...` and
   `DISCORD_BOT_TOKEN=...` (values are unused by Plan 1 but exercise rendering).
3. Bring it up:
   `nix run .#hermit-vm -- up docs/seed.example.yaml --secrets ./secrets.env`
   Expect: "✅ my-hermit is ready."
4. Verify status: `nix run .#hermit-vm -- status my-hermit` → phase: ready
5. Verify the plumbing:
   - `cat ~/.local/share/hermit-vm/my-hermit/runtime/status.json` → `"phase":"ready"`
   - `ls ~/.local/share/hermit-vm/my-hermit/state.img` exists (auto-created)
6. Tear down: `nix run .#hermit-vm -- down my-hermit --wipe`
   Expect: VM stops via the control socket; state dir removed.
```

- [ ] **Step 3: Perform the manual e2e on the Mac**

Run the steps in `docs/manual-e2e.md`.
Expected: `up` reaches `✅ ... is ready`; `status.json` shows `phase: ready`; `state.img` exists; `down --wipe` stops the VM and removes the dir. If `up` hangs, inspect `~/.local/share/hermit-vm/my-hermit/runtime/hermit.log`.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/manual-e2e.md
git commit -m "docs: README and manual e2e for VM skeleton"
```

---

## Self-Review (completed)

- **Spec coverage:** Plan 1 covers the spec's host-state layout, seed/secrets split, preflight (incl. linux-builder remediation), vfkit launch + **control-socket** stop, persistent volume, seed (RO) + runtime (RW) virtiofs shares, status protocol, and the `up`/`status`/`logs`/`down` lifecycle. **Deferred to Plan 2** (intentionally, not gaps): native Hermit service, two-phase `hermit-init`→`hermit-agent`, `hatch`-with-prompt, both auth paths + OAuth refresh, Discord pairing/check-in, `reseed-auth`, `--rehatch`, seed-driven sizing, and the Linux/qemu portability branch.
- **Spec corrections folded in:** vfkit *has* a control socket (clean stop, not SIGKILL); explicit `type="user"` interface required; RO shares are advisory via mount option; `CLAUDE_CODE_OAUTH_TOKEN`/`ANTHROPIC_API_KEY` preferred over copied OAuth creds (carried into the secrets schema for Plan 2).
- **Placeholder scan:** none — every code/command step contains concrete content.
- **Type consistency:** `CliDeps`, `RunResult`, `Seed`, `Secrets`, `VmPaths`, `Status` names and signatures are consistent across tasks; commands self-register via `registerCommand`.
```
