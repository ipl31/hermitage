{ pkgs, lib, ... }:
let
  bootstrapSrc = ../guest/bootstrap;   # contains main.ts + lib.ts
  # hermit's bin/* scripts use `#!/usr/bin/env bash` and shell out to common
  # tools, so bash + the usual userland must be on the service PATH.
  runtimePath = lib.makeBinPath (with pkgs; [
    claude-code bun nodejs_22 git gh jq socat
    bash coreutils gnugrep gnused gawk findutils which util-linux
  ]);
  # hermit-start runs an interactive `claude` session, which needs a TTY; under
  # a systemd service there is none, so claude falls back to --print and errors.
  # Allocate a pseudo-terminal with util-linux `script`.
  agentLauncher = pkgs.writeShellScript "hermit-agent-launch" ''
    exec ${pkgs.util-linux}/bin/script -qec \
      "/var/lib/hermit/project/.claude-code-hermit/bin/hermit-start --no-tmux" /dev/null
  '';
  # Write status=running from a script file. (An inline systemd `bash -c` with
  # `%s`/`date +%s` is wrong: systemd expands `%s` as a unit specifier before
  # bash runs, producing invalid JSON. Script-file contents are not specifier-
  # expanded, so printf/date work normally here.)
  setRunning = pkgs.writeShellScript "hermit-set-running" ''
    printf '{"phase":"running","ts":%s}' "$(${pkgs.coreutils}/bin/date +%s)" \
      > /run/hermit-runtime/status.json
  '';
  # Written by OnFailure when hermit-agent exceeds its restart limit, so the host
  # sees `crashlooping` instead of a stale `running`.
  setCrashlooping = pkgs.writeShellScript "hermit-set-crashlooping" ''
    printf '{"phase":"crashlooping","ts":%s}' "$(${pkgs.coreutils}/bin/date +%s)" \
      > /run/hermit-runtime/status.json
  '';
in {
  systemd.services.hermit-init = {
    description = "Hermit one-time bootstrap (pre-seed + hatch)";
    wantedBy = [ "multi-user.target" ];
    after = [ "local-fs.target" "network-online.target" ];
    wants = [ "network-online.target" ];
    unitConfig.ConditionPathExists = "!/var/lib/hermit/.hermit-initialized";
    environment.PATH = lib.mkForce runtimePath;
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
      ExecStart = "${pkgs.bun}/bin/bun run ${bootstrapSrc}/main.ts";
      TimeoutStartSec = "900";
      # Surface bootstrap + hatch output on the serial console (captured by the
      # host), not just the in-guest journal — the VM has no SSH/vsock.
      StandardOutput = "journal+console";
      StandardError = "journal+console";
    };
  };

  systemd.paths.hermit-auth-reload = {
    wantedBy = [ "multi-user.target" ];
    pathConfig.PathModified = "/run/hermit-runtime/agent.env";
  };
  systemd.services.hermit-auth-reload = {
    serviceConfig = {
      Type = "oneshot";
      ExecStart = "${pkgs.systemd}/bin/systemctl restart hermit-agent.service";
    };
  };

  systemd.paths.hermit-rehatch = {
    wantedBy = [ "multi-user.target" ];
    pathConfig.PathExists = "/run/hermit-runtime/rehatch-request";
  };
  systemd.services.hermit-rehatch = {
    path = [ pkgs.coreutils pkgs.systemd ];
    serviceConfig.Type = "oneshot";
    script = ''
      rm -f /var/lib/hermit/.hermit-initialized
      systemctl restart hermit-init.service
      systemctl restart hermit-agent.service
      rm -f /run/hermit-runtime/rehatch-request
    '';
  };

  systemd.services.hermit-agent = {
    description = "Hermit never-ending session";
    wantedBy = [ "multi-user.target" ];
    requires = [ "hermit-init.service" ];
    after = [ "hermit-init.service" "network-online.target" ];
    wants = [ "network-online.target" ];
    environment.PATH = lib.mkForce runtimePath;
    # If the session exits and restarts 5+ times within 5 min, stop trying and
    # fire OnFailure -> crashlooping status (instead of a perpetual false
    # `running` from ExecStartPost on each spawn).
    startLimitIntervalSec = 300;
    startLimitBurst = 5;
    unitConfig.OnFailure = "hermit-agent-failed.service";
    serviceConfig = {
      Type = "simple";
      WorkingDirectory = "/var/lib/hermit/project";
      EnvironmentFile = "/run/hermit-runtime/agent.env";
      ExecStart = "${agentLauncher}";
      ExecStartPost = "${setRunning}";
      StandardOutput = "journal+console";
      StandardError = "journal+console";
      Restart = "always";
      RestartSec = "10";
    };
  };

  # Fired by hermit-agent's OnFailure (restart limit exceeded) to record the
  # crash-loop so `hermit-vm status`/`up` surface it.
  systemd.services.hermit-agent-failed = {
    serviceConfig = { Type = "oneshot"; ExecStart = "${setCrashlooping}"; };
  };
}
