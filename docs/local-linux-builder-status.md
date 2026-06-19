# Local linux-builder on the dev Mac (Apple Silicon)

**Goal:** an `aarch64-linux` builder on the Mac so the NixOS microVM guest can be
built locally (needed for `nix run .#e2e-local`, which boots via real vfkit).

## Status: WORKING (via TCG)

Set up with nix-darwin (`~/.config/nix-darwin/flake.nix`):
`nix.linux-builder.enable = true;`, `trusted-users` includes the dev user.

### The qemu/HVF problem and the fix

The default nix-darwin builder runs its VM with **qemu + Hypervisor.framework**
(`-machine …,accel=hvf:tcg`). On macOS 15.5 / Apple Silicon, qemu 11.0.1 **aborts
in `hvf_arch_init_vcpu`** (GLib assertion → SIGABRT, exit 134) and does **not**
fall back to TCG. So the builder VM crash-looped.

Fix applied in the nix-darwin config — force the builder VM to **TCG** software
emulation by injecting an env var into its launchd daemon:

```nix
launchd.daemons.linux-builder.serviceConfig.EnvironmentVariables.QEMU_OPTS =
  "-machine accel=tcg";
```

The builder's `run-nixos-vm` ends with `… $QEMU_OPTS "$@"`, so the appended
`-machine accel=tcg` overrides `accel=hvf:tcg`. The VM then boots fine (verified:
NixOS login prompt, SSH on :31022, zero crash reports) and real `aarch64-linux`
builds succeed.

### Why TCG is acceptable here

The guest needs **almost no compilation** — measured via `nix build --dry-run`:
~530 MiB of *precompiled* packages fetched from `cache.nixos.org`, plus cheap
NixOS config/unit derivations and one `mkfs.erofs`. TCG's slowdown hits CPU-bound
compiles, of which there are ~none. The main TCG cost is the one-time builder-VM
cold boot per session; once the guest is cached, `e2e-local` skips the builder
entirely and goes straight to the fast vfkit boot.

## Optional upgrade: native (VZ) builder

For native-speed local builds, swap the qemu/HVF builder for a
Virtualization.framework-based one (`nix-rosetta-builder`) — the same VZ stack
vfkit uses. It needs an existing Linux builder to bootstrap its VM image (no
public cache), which the **current TCG builder can now provide** (one slow
bootstrap build, then switch the default to VZ). Not yet done; TCG is sufficient
given the near-zero compilation above.

## Note: this is host config, not repo config

The builder lives in `~/.config/nix-darwin/`, outside this repo. It's a developer
convenience for `e2e-local`; **CI does not depend on it** (GitHub builds the guest
on native Linux runners).
