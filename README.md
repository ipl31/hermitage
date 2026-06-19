# Hermit microVM Deployer

Boot an isolated NixOS microVM on macOS (Apple Silicon) via vfkit that runs a
fully-bootstrapped claude-code-hermit agent. On first boot it pre-seeds auth +
plugins + onboarding/trust bypass, runs `/claude-code-hermit:hatch <prompt>`,
then keeps a never-ending session alive via systemd. The agent checks into its
configured Discord channel when ready.

## Commands
- `hermit-vm up <seed.yaml> --secrets <file> [--rehatch]`
- `hermit-vm status <name>` · `logs <name>` · `down <name> [--wipe]`
- `hermit-vm reseed-auth <name> --secrets <file>`  (live auth rotation)

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

## End-to-end VM boot test

Prove the microVM actually boots and tears down — same guest definition, three environments:

```bash
# Local, on bare-metal Apple Silicon: boots via REAL vfkit (Virtualization.framework)
nix run .#e2e-local
```

`e2e-local` builds the guest (via the local `aarch64-linux` builder), boots it under
vfkit, waits for the `HERMIT_CI_VM_READY` console marker, and confirms the guest
powers itself off (clean teardown). On bare metal this exercises the real product
hypervisor.

The local builder is a native VZ builder (`nix-rosetta-builder`). A ready-to-use
nix-darwin config + setup steps are vendored in [`nix/darwin-builder/`](nix/darwin-builder/).

In CI (`.github/workflows/e2e-vm.yml`) the same guest is booted on:
- an **x86 Linux** runner via QEMU+**KVM** (fast), and
- a **macOS** runner via QEMU+**TCG** (hosted macOS can't use vfkit — nested virt is blocked).

See `docs/local-linux-builder-status.md` for the local builder setup (and the
qemu/HVF workaround it required).

> **Warning:** `down <name> --wipe` deletes the VM's state directory **without confirmation**. There is no prompt; the deletion is immediate and irreversible.
