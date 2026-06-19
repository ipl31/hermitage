# Placeholder service for Plan 1: proves the seed share is readable, the
# runtime share is writable, and the persistent volume is mounted.
# Plan 2 replaces this with hermit-init + hermit-agent.
{ pkgs, lib, ... }:
{
  systemd.services.hermit-status = {
    description = "Hermit status writer (plumbing proof)";
    wantedBy = [ "multi-user.target" ];
    after = [ "local-fs.target" ];
    unitConfig.RequiresMountsFor = [ "/run/hermit-seed" "/run/hermit-runtime" "/var/lib/hermit" ];
    serviceConfig = { Type = "oneshot"; RemainAfterExit = true; };
    path = [ pkgs.coreutils pkgs.jq ];
    script = ''
      set -euo pipefail
      seed=/run/hermit-seed/config.json
      out=/run/hermit-runtime
      log="$out/hermit.log"

      name="unknown"
      if [ -r "$seed" ]; then name="$(jq -r '.name // "unknown"' "$seed")"; fi

      # Prove the persistent volume is writable.
      touch /var/lib/hermit/.plan1-volume-ok

      ts="$(date +%s)"
      printf '{"phase":"ready","name":"%s","ts":%s}\n' "$name" "$ts" > "$out/status.json"
      echo "[$ts] hermit-status: ready (name=$name)" >> "$log"
    '';
  };
}
