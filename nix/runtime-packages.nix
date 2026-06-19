{ pkgs, ... }:
{
  nixpkgs.config.allowUnfree = true;  # claude-code is unfree

  environment.systemPackages = with pkgs; [
    claude-code bun nodejs_22 git gh jq socat coreutils
  ];

  # Persistent layout on the /var/lib/hermit volume.
  systemd.tmpfiles.rules = [
    "d /var/lib/hermit 0700 root root - -"
    "d /var/lib/hermit/.claude 0700 root root - -"
    "d /var/lib/hermit/project 0700 root root - -"
  ];
}
