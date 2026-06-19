# Builds the guest nixosSystem. Parameterized by hypervisor so a later plan
# can target qemu on Linux without touching guest-config.nix.
{ nixpkgs, microvm, guestSystem, hostSystem, hypervisor }:
nixpkgs.lib.nixosSystem {
  system = guestSystem;
  specialArgs = { inherit hypervisor; };
  modules = [
    microvm.nixosModules.microvm
    ./guest-config.nix
  ] ++ nixpkgs.lib.optional (hypervisor == "vfkit") {
    # vfkit is darwin-only: the runner (vfkit binary + wrapper) must come from
    # the host's darwin package set, while the guest stays aarch64-linux.
    microvm.vmHostPackages = nixpkgs.legacyPackages.${hostSystem};
  };
}
