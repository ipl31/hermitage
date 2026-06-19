{ pkgs, lib, ... }:
let
  bootstrapSrc = ../guest/bootstrap;   # contains main.ts + lib.ts
  runtimePath = lib.makeBinPath (with pkgs; [ claude-code bun nodejs_22 git gh jq socat coreutils ]);
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
    serviceConfig = {
      Type = "simple";
      WorkingDirectory = "/var/lib/hermit/project";
      EnvironmentFile = "/run/hermit-runtime/agent.env";
      ExecStart = "/var/lib/hermit/project/.claude-code-hermit/bin/hermit-start --no-tmux";
      ExecStartPost = "${pkgs.bash}/bin/bash -c 'printf \"{\\\"phase\\\":\\\"running\\\",\\\"ts\\\":%s}\" $(date +%s) > /run/hermit-runtime/status.json'";
      Restart = "always";
      RestartSec = "10";
    };
  };
}
