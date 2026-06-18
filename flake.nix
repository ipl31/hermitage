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
      nixosConfigurations.hermit = import ./nix/guest.nix {
        inherit nixpkgs microvm guestSystem hostSystem;
        hypervisor = "vfkit";
      };

      packages.${hostSystem} = {
        hermit = self.nixosConfigurations.hermit.config.microvm.declaredRunner;
        hermit-vm = pkgs.callPackage ./cli/package.nix { };
        default = self.packages.${hostSystem}.hermit-vm;
      };

      apps.${hostSystem}.default = {
        type = "app";
        program = "${self.packages.${hostSystem}.hermit-vm}/bin/hermit-vm";
      };
    };
}
