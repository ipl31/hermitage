{
  description = "macOS nix-darwin config: a native aarch64-linux builder (nix-rosetta-builder) for `nix run .#e2e-local`";

  inputs = {
    # Matched 25.11 stable pair. nixpkgs-unstable currently ships a broken
    # `openapv` fixed-output derivation (stale source hash) in the host-qemu ->
    # ffmpeg chain that nix-rosetta-builder pulls; 25.11 avoids it. nix-darwin
    # asserts its branch matches nixpkgs, so both are pinned to 25.11.
    #
    # NOTE: this is the BUILDER's nixpkgs and is independent of the Hermit guest
    # flake (../../flake.nix), which intentionally stays on nixpkgs-unstable.
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-25.11-darwin";
    nix-darwin.url = "github:nix-darwin/nix-darwin/nix-darwin-25.11";
    nix-darwin.inputs.nixpkgs.follows = "nixpkgs";
    nix-rosetta-builder.url = "github:cpick/nix-rosetta-builder";
    nix-rosetta-builder.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = { self, nixpkgs, nix-darwin, nix-rosetta-builder }:
    let
      # >>> EDIT ME <<< your macOS login user.
      username = "ken";
    in {
      # Apply with: darwin-rebuild switch --flake .#default
      darwinConfigurations."default" = nix-darwin.lib.darwinSystem {
        system = "aarch64-darwin"; # Apple Silicon
        modules = [
          nix-rosetta-builder.darwinModules.default
          {
            nixpkgs.hostPlatform = "aarch64-darwin";
            # nix-rosetta-builder uses Lima; 25.11 ships lima 1.2.2 (EOL/insecure).
            # Acceptable for a local build VM.
            nixpkgs.config.permittedInsecurePackages = [ "lima-1.2.2" ];
            system.stateVersion = 6;
            system.primaryUser = username;

            nix.settings.experimental-features = [ "nix-command" "flakes" ];
            nix.settings.trusted-users = [ "root" username ];

            # Native-speed aarch64-linux builder via Apple Virtualization.framework
            # (Lima + Rosetta) — the same VZ stack vfkit uses; works on bare metal.
            nix-rosetta-builder = {
              enable = true;
              onDemand = true; # power the builder VM off when idle
            };

            # --- FRESH-MAC BOOTSTRAP (uncomment for the FIRST switch only) ---
            # nix-rosetta-builder needs an existing Linux builder to build its own
            # VM image. On a Mac with no builder yet, temporarily enable the
            # nix-darwin builder forced to TCG (qemu 11 + Hypervisor.framework
            # aborts on macOS 15.5, so plain accel=hvf:tcg crash-loops). Run
            # `darwin-rebuild switch` once to bootstrap rosetta, then re-comment
            # this block and switch again to retire it.
            #
            # nix.linux-builder = { enable = true; maxJobs = 4; };
            # launchd.daemons.linux-builder.serviceConfig.EnvironmentVariables.QEMU_OPTS =
            #   "-machine accel=tcg";
          }
        ];
      };
    };
}
