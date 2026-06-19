# Local linux-builder on the dev Mac (Apple Silicon)

**Goal:** an `aarch64-linux` builder on the Mac so the NixOS microVM guest can be
built locally (needed for `nix run .#e2e-local`, which boots via real vfkit).

## Status: WORKING — native VZ builder (`nix-rosetta-builder`)

The builder is now `nix-rosetta-builder`, which runs a Linux build VM via Apple
**Virtualization.framework** (Lima + Rosetta) — the same VZ stack `vfkit` uses,
so builds run at **native speed** on bare metal (a trivial aarch64-linux build
routes to `ssh-ng://rosetta-builder` in ~3s; the VM is `onDemand`, powering off
when idle).

Config lives in `~/.config/nix-darwin/flake.nix`:

```nix
inputs = {
  # Matched stable pair — see "openapv" note below.
  nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-25.11-darwin";
  nix-darwin.url = "github:nix-darwin/nix-darwin/nix-darwin-25.11";
  nix-darwin.inputs.nixpkgs.follows = "nixpkgs";
  nix-rosetta-builder.url = "github:cpick/nix-rosetta-builder";
  nix-rosetta-builder.inputs.nixpkgs.follows = "nixpkgs";
};
# in the darwin module:
nixpkgs.config.permittedInsecurePackages = [ "lima-1.2.2" ];  # Lima EOL on 25.11
nix-rosetta-builder = { enable = true; onDemand = true; };
```

### Gotchas hit along the way (all upstream/environmental)

1. **Bootstrap chicken-and-egg.** `nix-rosetta-builder` needs an *existing* Linux
   builder to build its own VM image (no public cache). Bootstrapped it once on a
   temporary **TCG** `nix.linux-builder` (see below), then retired that.
2. **Broken `openapv` FOD on `nixpkgs-unstable`.** The host-qemu→ffmpeg chain
   pulls `openapv-0.2.1.2`, whose pinned source hash is **stale/wrong** on current
   unstable (`hash mismatch … specified 1gas028… got 1q42a29…`) — unsatisfiable
   from cache *or* source. Pinning the builder to the **matched 25.11 stable pair**
   avoids it (stable ships `openapv-0.2.0.4`, which substitutes cleanly). The
   builder's nixpkgs is independent of the guest flake's (which stays unstable).
3. **nix-darwin ↔ nixpkgs version lock.** nix-darwin asserts its branch matches
   nixpkgs; hence both pinned to `25.11`.
4. **Lima 1.2.2 EOL/insecure** on 25.11 → `permittedInsecurePackages`.

### The TCG bootstrap fallback (qemu/HVF workaround)

To bootstrap on a **fresh Mac** (no Linux builder yet), temporarily enable the
default nix-darwin builder forced to TCG, build rosetta once, then remove it:

```nix
nix.linux-builder = { enable = true; maxJobs = 4; };
# qemu 11.0.1 + HVF aborts in hvf_arch_init_vcpu on macOS 15.5 (accel=hvf:tcg
# does NOT fall back), so force pure TCG:
launchd.daemons.linux-builder.serviceConfig.EnvironmentVariables.QEMU_OPTS =
  "-machine accel=tcg";
```

Bootstrap build of the rosetta image on TCG took ~38 min (one-time); afterwards
`darwin-rebuild switch` with `nix.linux-builder` removed leaves rosetta as the
sole builder.

## Note: this is host config, not repo config

The builder lives in `~/.config/nix-darwin/`, outside this repo. It's a developer
convenience for `e2e-local`; **CI does not depend on it** (GitHub builds the guest
on native Linux runners). For a tracked, reproducible setup, the nix-darwin module
above can be vendored into the repo or your dotfiles.
