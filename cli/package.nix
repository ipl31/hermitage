{ writeShellApplication, bun, nix, socat, coreutils }:
writeShellApplication {
  name = "hermit-vm";
  runtimeInputs = [ bun nix socat coreutils ];
  text = ''
    exec ${bun}/bin/bun run ${./src}/index.ts "$@"
  '';
}
