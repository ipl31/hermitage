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
      # The product guest: vfkit hypervisor on a macOS host.
      nixosConfigurations.hermit = import ./nix/guest.nix {
        inherit nixpkgs microvm guestSystem hostSystem;
        hypervisor = "vfkit";
      };

      # CI boot-test guests (QEMU). One per Linux arch so the E2E can boot under
      # KVM (x86_64 Linux runner) or TCG (aarch64, incl. macOS runners).
      nixosConfigurations.hermit-ci-x86_64 = import ./nix/guest-ci.nix {
        inherit nixpkgs microvm;
        system = "x86_64-linux";
      };
      nixosConfigurations.hermit-ci-aarch64 = import ./nix/guest-ci.nix {
        inherit nixpkgs microvm;
        system = "aarch64-linux";
      };

      packages.${hostSystem} = {
        hermit = self.nixosConfigurations.hermit.config.microvm.declaredRunner;
        hermit-vm = pkgs.callPackage ./cli/package.nix { };
        default = self.packages.${hostSystem}.hermit-vm;
      };

      # CI runner packages, exposed under the matching Linux host systems.
      packages.x86_64-linux.ci-runner =
        self.nixosConfigurations.hermit-ci-x86_64.config.microvm.declaredRunner;
      packages.aarch64-linux.ci-runner =
        self.nixosConfigurations.hermit-ci-aarch64.config.microvm.declaredRunner;

      apps.${hostSystem}.default = {
        type = "app";
        program = "${self.packages.${hostSystem}.hermit-vm}/bin/hermit-vm";
      };
    };
}
