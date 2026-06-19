# The guest NixOS configuration for the Hermit microVM.
# In this plan it is intentionally Hermit-free: it only proves the
# host<->guest plumbing by writing a status file to the runtime share.
{ lib, pkgs, hypervisor, ... }:
{
  imports = [ ./status-writer.nix ];

  networking.hostName = "hermit";
  system.stateVersion = "24.11";

  # vfkit requires an explicitly declared user-mode NIC for outbound NAT.
  microvm = {
    inherit hypervisor;
    vcpu = 2;
    mem = 2048;

    # Relative paths resolve against the runner process CWD, which the CLI
    # sets to the per-VM host state dir.
    socket = "hermit.sock";

    interfaces = [{
      type = "user";
      id = "eth0";
      mac = "02:00:00:00:00:01";
    }];

    shares = [
      {
        proto = "virtiofs";
        tag = "hermit-seed";
        source = "seed";            # ~/.local/share/hermit-vm/<name>/seed
        mountPoint = "/run/hermit-seed";
      }
      {
        proto = "virtiofs";
        tag = "hermit-runtime";
        source = "runtime";         # ~/.local/share/hermit-vm/<name>/runtime
        mountPoint = "/run/hermit-runtime";
      }
    ];

    volumes = [{
      image = "state.img";          # ~/.local/share/hermit-vm/<name>/state.img
      mountPoint = "/var/lib/hermit";
      size = 4096;
      autoCreate = true;
      fsType = "ext4";
    }];
  };

  # Advisory read-only mount for the seed share (vfkit does not host-enforce).
  fileSystems."/run/hermit-seed".options = lib.mkForce [ "ro" "nofail" ];

  networking.useDHCP = lib.mkDefault true;
}
