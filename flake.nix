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

      # aarch64-linux guest, but with a DARWIN-hosted qemu runner so it can boot
      # under QEMU+TCG on a macOS CI runner (vfkit/VZ is unavailable there).
      nixosConfigurations.hermit-ci-darwin = import ./nix/guest-ci.nix {
        inherit nixpkgs microvm;
        system = "aarch64-linux";
        vmHostPackages = nixpkgs.legacyPackages.aarch64-darwin;
      };

      # Local macOS bare-metal boot test: same guest, but the REAL vfkit
      # hypervisor (works on bare metal; hosted CI cannot use it).
      nixosConfigurations.hermit-ci-vfkit = import ./nix/guest-ci.nix {
        inherit nixpkgs microvm;
        system = "aarch64-linux";
        hypervisor = "vfkit";
        vmHostPackages = nixpkgs.legacyPackages.aarch64-darwin;
      };

      packages.${hostSystem} = {
        hermit = self.nixosConfigurations.hermit.config.microvm.declaredRunner;
        hermit-vm = pkgs.callPackage ./cli/package.nix { };
        default = self.packages.${hostSystem}.hermit-vm;
        # darwin-hosted qemu runner for the CI boot test
        ci-runner = self.nixosConfigurations.hermit-ci-darwin.config.microvm.declaredRunner;
        # vfkit runner for the local bare-metal boot test
        ci-runner-vfkit = self.nixosConfigurations.hermit-ci-vfkit.config.microvm.declaredRunner;
        # single-command local E2E: build guest + boot via vfkit + assert
        e2e-local = pkgs.callPackage ./nix/e2e-local.nix {
          runner = self.nixosConfigurations.hermit-ci-vfkit.config.microvm.declaredRunner;
        };
      };

      # CI runner packages, exposed under the matching Linux host systems.
      packages.x86_64-linux.ci-runner =
        self.nixosConfigurations.hermit-ci-x86_64.config.microvm.declaredRunner;
      packages.aarch64-linux.ci-runner =
        self.nixosConfigurations.hermit-ci-aarch64.config.microvm.declaredRunner;

      apps.${hostSystem} = {
        default = {
          type = "app";
          program = "${self.packages.${hostSystem}.hermit-vm}/bin/hermit-vm";
        };
        # `nix run .#e2e-local` — build + boot the microVM via vfkit + assert.
        e2e-local = {
          type = "app";
          program = "${self.packages.${hostSystem}.e2e-local}/bin/hermit-e2e-local";
        };
      };
    };
}
