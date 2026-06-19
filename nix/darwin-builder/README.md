# macOS builder for the local E2E (`nix run .#e2e-local`)

`nix run .#e2e-local` builds the NixOS microVM guest (an `aarch64-linux` system)
and boots it via real `vfkit`. macOS can't build Linux without a Linux builder,
so this directory vendors a ready-to-use **nix-darwin** flake that provides one:
`nix-rosetta-builder` (Apple Virtualization.framework — native speed on bare-metal
Apple Silicon).

This is **host config**, separate from the project flake. CI does **not** need it
(GitHub builds the guest on native Linux runners). It's only for running the E2E
locally.

## Prerequisites (manual, one-time)
1. **Nix** with flakes enabled (e.g. the Determinate Systems installer).
2. **Rosetta:** `softwareupdate --install-rosetta`.
3. **nix-darwin** not strictly required up front — the steps below bootstrap it.

## Setup
```sh
mkdir -p ~/.config/nix-darwin
cp nix/darwin-builder/flake.nix ~/.config/nix-darwin/flake.nix
# edit `username` in that file to your macOS login user
```

### First Mac (no Linux builder yet) — bootstrap
`nix-rosetta-builder` needs an existing Linux builder to build its own VM image.
Bootstrap once with a temporary TCG builder:

1. In `~/.config/nix-darwin/flake.nix`, **uncomment** the `FRESH-MAC BOOTSTRAP`
   block (the `nix.linux-builder` + `QEMU_OPTS` lines).
2. Apply (installs nix-darwin on first run):
   ```sh
   sudo nix --extra-experimental-features 'nix-command flakes' \
     run nix-darwin/master#darwin-rebuild -- switch --flake ~/.config/nix-darwin#default
   ```
   (If it complains about `/etc/nix/nix.conf`, `/etc/bashrc`, or `/etc/zshrc`,
   `sudo mv` each to `*.before-nix-darwin` and re-run.)
   This builds the rosetta image on the TCG builder (~30–40 min, one-time).
3. **Re-comment** the bootstrap block and switch again to retire the TCG builder:
   ```sh
   sudo darwin-rebuild switch --flake ~/.config/nix-darwin#default
   ```

### Subsequent Macs / re-applies
Just `sudo darwin-rebuild switch --flake ~/.config/nix-darwin#default`.

## Verify
```sh
cat /etc/nix/machines           # should list ssh-ng://rosetta-builder
# native aarch64-linux build routes to rosetta (~seconds):
nix build --impure --expr \
  'let p = (builtins.getFlake "github:NixOS/nixpkgs/nixpkgs-25.11-darwin").legacyPackages.aarch64-linux; in p.runCommand "smoke" {} "uname -mo > $out"' -L
# then, from the repo root:
nix run .#e2e-local
```

## Why the version pins / workarounds
See `docs/local-linux-builder-status.md` for the full story (broken `openapv` FOD
on unstable, nix-darwin↔nixpkgs version lock, Lima EOL, and the qemu/HVF→TCG
bootstrap fallback).
