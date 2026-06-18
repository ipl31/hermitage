# Hermit microVM Deployer — Design

**Date:** 2026-06-18
**Status:** Approved design, pending implementation plan

## Summary

A tool that deploys [`claude-code-hermit`](https://github.com/gtapps/claude-code-hermit) — a
persistent, autonomous Claude Code agent — into a Nix [microVM](https://github.com/microvm-nix/microvm.nix).
From a single command, given a seed file of credentials and setup configuration, the tool builds
and launches the agent inside an isolated NixOS microVM. The agent comes up ready to work and
checks in via its configured chat channel (Discord).

The deliverable is a **Nix flake plus a thin CLI wrapper** (`hermit-vm`).

## Goals

- One command (`hermit-vm up`) takes a user from seed → running, checked-in agent.
- Non-interactive: no manual `claude /login`, no setup wizard clicking.
- Reproducible and resilient to upstream Hermit changes.
- Portable across host platforms, **macOS first**, Linux next.

## Non-Goals (this iteration)

- Linux host support is **wired but guarded off** ("not yet supported") until iteration 2.
- Multi-agent fleet orchestration, web UI, or remote/cloud hosting.
- Telegram or non-Discord channels (architecture allows it; Discord is the target now).

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Host platform | Portable, **macOS-first** (vfkit), Linux/qemu later | User runs on a Mac; abstract the seam now, implement mac first. |
| Hermit runtime in VM | **Native NixOS systemd service** (no Docker) | The microVM already provides kernel isolation; avoids a nested runtime. |
| Claude auth | **Both** API key and seeded OAuth creds | Flexibility; detect from seed; OAuth refresh/re-seed story included. |
| Tool form | **Nix flake + thin CLI wrapper** | Self-contained, portable, ergonomic single command. |
| Hatch/setup | **Hybrid** — deterministic pre-seed + `hatch <prompt>` | Pre-seed what the model can't do (secrets, onboarding/trust bypass); let `hatch` figure out the rest, robust to upstream file/dir changes. |
| Seed format | **Split** `seed.yaml` (config) + secrets file | Clean secret hygiene; config is safe to commit. |
| In-VM bootstrap | **Two-phase systemd**: `bootstrap` (oneshot) → `hermit` (long-running) | Isolates the fragile model-driven hatch from the durable session; idempotent; clean `journalctl` per phase. |

## Background (from research)

**claude-code-hermit** is a Claude Code *plugin* — "a Claude Code session that doesn't end" — built
on `/loop`, `CronCreate`, Channels, and hooks. Its blessed always-on path runs Claude Code + Bun +
the CLI (Ubuntu 24.04 image). Setup is driven by interactive skills (`hatch`, `docker-setup`,
`channel-setup`), but each only *writes known files*, so the setup is pre-seedable. The `hatch` skill
accepts a trailing prompt. Relevant artifacts: `config.json` (no secrets), `.claude/settings.local.json`
(env + permissions), `~/.claude/.credentials.json` (OAuth), channel `<state_dir>/.env`
(`DISCORD_BOT_TOKEN`), `GH_TOKEN`/`HERMIT_GH_TOKEN`, onboarding/trust bypass via `.claude.json`
(`hasCompletedOnboarding`, trust flags), MCP pre-approval via `enabledMcpjsonServers`,
`permission_mode: bypassPermissions`.

**microvm.nix** builds a NixOS system and runs it on a Type-2 hypervisor. Defaults to `qemu` on Linux
(with zero-config `type="user"` outbound networking). On **macOS the only backend is `vfkit`**
(Apple Virtualization.framework): no tap, no 9p, **virtiofs shares supported**, NAT outbound by
default — and the Linux guest **requires a Linux builder** (`nix.linux-builder` via nix-darwin) since
darwin cannot build Linux. Secrets enter the guest via virtiofs shares; persistent state via a volume
(block image); the writable store overlay does not persist across reboots.

## Architecture

```
┌─ host (macOS now / Linux later) ──────────────────────────────┐
│  hermit-vm  (CLI wrapper)                                      │
│    up · status · logs · down · reseed-auth · --rehatch        │
│        ├─ preflight (nix, linux-builder, vfkit/KVM)           │
│        ├─ render host state dir  ~/.local/share/hermit-vm/<n>/ │
│        │     ├─ seed/        → virtiofs RO  → /run/hermit-seed │
│        │     └─ runtime/     → virtiofs RW  → status + logs    │
│        ├─ ensure state.img  (persistent volume)               │
│        └─ nix build + launch microVM                          │
│   flake.nix  →  nixosConfigurations.<name>  (the guest)       │
└────────────────────────────────────────────────────────────────┘
                            │ boots
        ┌───────────────────▼─────────────────────────┐
        │  NixOS microVM guest                          │
        │   pkgs: nodejs · bun · claude-code · git      │
        │   volume /var/lib/hermit  (persistent state)  │
        │     ├─ project + .claude-code-hermit/         │
        │     ├─ ~/.claude (creds, access.json)         │
        │     └─ .hermit-bootstrapped  (marker)         │
        │   systemd:                                    │
        │     hermit-bootstrap.service (oneshot,guarded)│
        │        → pre-seed + /…:hatch <prompt>         │
        │     hermit.service (Restart=always) ─After──▶ │
        │        → never-ending Claude session          │
        │   net: VZ NAT (mac) / user-net (linux) ──▶ 🌐 │
        └───────────────────────────────────────────────┘
```

### Components

1. **`flake.nix`** — defines the microVM `nixosConfiguration` (parameterized by name + a passed
   `hypervisor`), exposes `packages.hermit-vm` and apps (`up`/`status`/`logs`/`down`). Guest is
   `aarch64-linux`, built via the macOS linux-builder.
2. **`hermit-vm` CLI wrapper** — the single entry point: preflight, seed→host-state rendering, volume
   management, build, launch, status reporting.
3. **NixOS guest module** — packages Hermit's runtime natively (nodejs, bun, claude-code CLI, git),
   defines the two systemd units, mounts seed (RO) + runtime (RW) virtiofs shares and the persistent
   state volume, sets up NAT outbound.
4. **Seed** — `seed.yaml` (config) + a secrets file, rendered by the wrapper into the RO seed share.
5. **Persistent state volume** (`state.img`) — survives reboots; carries Claude creds, Hermit project
   state, paired channel `access.json`, and the first-boot marker.

## Data Flow

`hermit-vm up seed.yaml --secrets secrets.env`:

1. **Preflight** — verify flake-enabled `nix`; on macOS verify a Linux builder is reachable and
   `vfkit` is present. Missing linux-builder → print the exact `nix.linux-builder.enable` remediation
   and exit. Never auto-mutate the host's nix-darwin config.
2. **Render host state** into `~/.local/share/hermit-vm/<name>/`:
   - `seed/config.json` — non-secret knobs (agent name, timezone, channels, allowed users, routines,
     hatch prompt).
   - `seed/secrets/` — `claude-creds.json` *or* `anthropic.env`; `discord.env`
     (`DISCORD_BOT_TOKEN`, channel id); `github.env` (`GH_TOKEN`); `extra/*` cred files verbatim.
     Dir `chmod 700`, files `600`.
   - `runtime/` — empty; guest writes `status.json` + `hermit.log` here (RW share).
3. **Ensure volume** — create `state.img` (size from seed, default 8 GB) if absent; reuse if present.
4. **Build + launch** — build the guest runner via the linux-builder; start the VM (vfkit). Network =
   VZ NAT → outbound to Anthropic/Discord/GitHub with zero host config; no inbound needed.
5. **Report** — poll `runtime/status.json` through phases until `checked_in`; print success + where
   the agent reported in. Timeout → point at `hermit-vm logs`.

### First boot (no marker)

```
boot → hermit-bootstrap.service (oneshot)
   1. read /run/hermit-seed
   2. write Claude auth: creds.json → ~/.claude/.credentials.json
                         OR ANTHROPIC_API_KEY → service env
   3. write channel state: discord .env + DISCORD_STATE_DIR in settings.local.json
   4. write GH_TOKEN; drop extra creds where seed maps them
   5. bypass onboarding/trust: hasCompletedOnboarding + trust flags in .claude.json
   6. set permission_mode = bypassPermissions
   7. install plugins (claude-code-hermit + channel) @ local scope,
      pre-approve MCP servers (enabledMcpjsonServers)
   8. status=hatching → run once: claude -p "/claude-code-hermit:hatch <prompt>"
   9. write .hermit-bootstrapped marker; status=bootstrapped
        │ After=success
        ▼
hermit.service (Restart=always)
   → launch never-ending Claude session (loop); status=running
   → agent connects to Discord, posts readiness; status=checked_in
```

### Subsequent boots

Marker present → bootstrap skipped entirely; `hermit.service` starts straight away (fast restart, no
re-hatch). `--rehatch` deletes the marker to force a fresh hatch. OAuth refresh happens in-VM
automatically; dead refresh token → `status=auth_expired`, fixed by `hermit-vm reseed-auth`.

## Error Handling

- **Preflight** failures (no flake-enabled `nix`, missing linux-builder, missing `vfkit`) → specific
  message + exact remediation, non-zero exit. Never auto-mutate the host config.
- **Build** failures → surface the `nix` log path, exit.
- **Bootstrap** failures in-VM → `hermit-bootstrap.service` records `{phase, error}` into
  `runtime/status.json` and fails the unit; `up` polling detects the failed phase and stops with a
  pointer to `hermit-vm logs`. Phases are granular (`auth`→`channels`→`plugins`→`hatching`).
- **Session** crashes → `Restart=always` with backoff; repeated fast crashes flip status to
  `crashlooping` so `status` surfaces it rather than hanging on `running`.
- **Auth expiry** → in-VM refresh first; dead refresh token → `auth_expired` → `reseed-auth`.
- **Idempotency** → re-`up` reuses volume + marker (fast path); destructive actions (`down --wipe`,
  `--rehatch`) are explicit and confirm before deleting state.

## Testing

- **Wrapper unit/golden tests** — seed+secrets → rendered host-state layout (config.json, secrets
  perms, share mapping). Pure, fast, no VM.
- **`nix flake check`** + build the guest config in CI on a **Linux runner** (mac can't build Linux
  without the builder).
- **Boot integration test** — a guest variant where `claude` is a **stub binary** emitting the
  expected status transitions; asserts `bootstrap → service → status=checked_in` ordering, marker
  creation, and skip-on-second-boot. No real Anthropic/Discord calls.
- **Manual e2e** — real seed on a Mac → agent checks into a throwaway Discord channel.

## Portability Seam (mac now, Linux next)

One `hostPlatform` switch drives the four differences:

| Concern | macOS | Linux (iteration 2) |
|---|---|---|
| Hypervisor | `vfkit` | `qemu` |
| Networking | VZ NAT | `type="user"` (user-net) |
| Builder | requires `nix.linux-builder` | builds natively (Nix + KVM) |
| Shares | virtiofs | virtiofs |

Shares/volumes/systemd/seed logic are identical across both. The wrapper detects host OS; the guest
module takes `hypervisor` as an argument. **Iteration 1** implements and tests the macOS branch
fully; the Linux branch is wired but **guarded with a clear "not yet supported"** message — no silent
half-support.

## Seed Schema (sketch)

`seed.yaml` (non-secret, commitable):

```yaml
name: my-hermit                 # VM + state-dir name
agent_name: Hermit
timezone: America/New_York
resources:                      # optional, sensible defaults
  vcpu: 2
  mem_mb: 4096
  disk_gb: 8
channels:
  discord:
    enabled: true
    channel_id: "123456789012345678"
    allowed_users: ["234567890123456789"]
    morning_brief: "07:00"
routines: []                    # optional cron entries passed to hatch/config
hatch_prompt: |                 # fed to /claude-code-hermit:hatch on first boot
  Set yourself up as a helpful dev assistant for this project.
  Use balanced escalation. Announce readiness in Discord when ready.
secrets_file: ./secrets.env     # default; overridable by --secrets
```

Secrets file (`secrets.env`, gitignored):

```sh
# Exactly one Claude auth method:
ANTHROPIC_API_KEY=sk-ant-...
# --- or ---
CLAUDE_OAUTH_CREDS=./claude-credentials.json   # path to a captured .credentials.json

DISCORD_BOT_TOKEN=...
GH_TOKEN=...
# EXTRA_<NAME>=...  arbitrary creds passed through to the agent env
```

## Open Questions for Implementation Plan

- Exact NixOS packaging of the Claude Code CLI (nixpkgs `claude-code` if present, else
  `buildNpmPackage`/native-installer wrapper). To be resolved during planning.
- Whether the never-ending session is driven by Hermit's `hermit-start` equivalent or a direct
  `claude` loop invocation under systemd; reconcile with Hermit's expectations.
- Precise list of files/keys to pre-seed vs. leave to `hatch` (validate against current upstream at
  implementation time).
