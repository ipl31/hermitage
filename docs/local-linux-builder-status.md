# Local linux-builder status (Apple Silicon dev Mac)

**Goal:** an `aarch64-linux` builder on the Mac so the NixOS microVM guest can be
built locally.

**What was done:** nix-darwin installed and `nix.linux-builder.enable = true`
activated (config at `~/.config/nix-darwin/flake.nix`). `trusted-users` includes
`ken`; the `org.nixos.linux-builder` daemon is registered.

**Blocker (environmental, not config):** the builder VM fails to boot. Its
`qemu-system-aarch64` aborts in `hvf_arch_init_vcpu` (GLib assertion → SIGABRT,
exit 134) — a known qemu 11.0.1 + Apple Hypervisor.framework incompatibility on
macOS 15.5 / Apple Silicon. The default nix-darwin builder uses qemu+HVF, so it
cannot boot here. The crash-loop service has been `launchctl bootout`'d.

**Remediation options (pick later):**
1. Newer/patched qemu once the HVF assertion is fixed upstream.
2. A Virtualization.framework-based builder (e.g. nix-rosetta-builder) — note it
   needs an existing Linux builder to bootstrap its image, so seed it from a cache
   or a remote builder first.
3. A remote `aarch64-linux` builder (another Linux box / cloud) in
   `/etc/nix/machines`.

**Impact on CI:** none. The GitHub Actions E2E builds the guest on native Linux
runners; the macOS runner only boots a prebuilt guest (via QEMU TCG). The local
builder is a developer convenience, not a CI dependency.
