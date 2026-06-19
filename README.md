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

> **Warning:** `down <name> --wipe` deletes the VM's state directory **without confirmation**. There is no prompt; the deletion is immediate and irreversible.
