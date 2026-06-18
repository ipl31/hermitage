import type { CliDeps } from "./cli";

export async function preflight(deps: CliDeps): Promise<{ ok: boolean; problems: string[] }> {
  const problems: string[] = [];

  const nix = await deps.run("nix", ["--version"]);
  if (nix.code !== 0) {
    problems.push("nix not found. Install Nix (https://nixos.org/download) with flakes enabled.");
    return { ok: false, problems }; // nothing else will work without nix
  }

  const builder = await deps.run("nix", ["build", "nixpkgs#hello", "--system", "aarch64-linux", "--no-link"]);
  if (builder.code !== 0) {
    problems.push(
      "No aarch64-linux builder available (needed to build the Linux guest from macOS).\n" +
      "Fix one of:\n" +
      "  A) nix-darwin: set `nix.linux-builder.enable = true;` then `darwin-rebuild switch`.\n" +
      "  B) Determinate Nix: enable its built-in Linux builder.\n" +
      "  C) Add the github:cpick/nix-rosetta-builder module.\n" +
      "Verify with: nix build nixpkgs#hello --system aarch64-linux"
    );
  }

  const vfkit = await deps.run("nix", ["build", "nixpkgs#vfkit", "--no-link"]);
  if (vfkit.code !== 0) {
    problems.push("vfkit could not be realised via Nix (`nix build nixpkgs#vfkit`). Check your nixpkgs/network.");
  }

  return { ok: problems.length === 0, problems };
}
