# CI boot-test variant of the microVM guest.
#
# Unlike the product guest (vfkit, virtiofs shares, persistent volume), this
# variant is built to BOOT inside GitHub Actions and prove the deploy mechanism
# end to end: it boots under QEMU, a oneshot prints a unique READY marker to the
# serial console, then it powers itself off — giving CI a clean "booted" signal
# and an automatic teardown (QEMU exits on guest poweroff).
#
# It deliberately avoids virtiofs shares (storeOnDisk = true) so it needs no
# virtiofsd and boots identically under QEMU+KVM (Linux runner) or QEMU+TCG
# (macOS runner).
{ nixpkgs, microvm, system }:
let
  # serial console device differs by guest arch
  consoleDev = if nixpkgs.lib.hasPrefix "aarch64-" system then "ttyAMA0" else "ttyS0";
in
nixpkgs.lib.nixosSystem {
  inherit system;
  modules = [
    microvm.nixosModules.microvm
    ({ lib, pkgs, ... }: {
      networking.hostName = "hermit-ci";
      system.stateVersion = "24.11";

      microvm = {
        hypervisor = "qemu";
        vcpu = 2;
        mem = 1024;
        # Store on a disk image rather than a host virtiofs share, so no
        # virtiofsd is required and the same image boots under KVM or TCG.
        storeOnDisk = true;
        graphics.enable = false;
      };

      # Make sure kernel + init log to the serial console QEMU exposes on stdio.
      boot.kernelParams = [ "console=${consoleDev},115200" ];

      # Keep the boot minimal/fast for TCG emulation.
      documentation.enable = false;
      services.getty.autologinUser = lib.mkDefault "root";

      # The boot proof: print a unique marker, then power off (clean teardown).
      systemd.services.hermit-ci-ready = {
        description = "CI boot proof — signal readiness then power off";
        wantedBy = [ "multi-user.target" ];
        after = [ "multi-user.target" "systemd-user-sessions.service" ];
        serviceConfig = {
          Type = "oneshot";
          StandardOutput = "journal+console";
        };
        script = ''
          echo "HERMIT_CI_VM_READY token=ci-boot-ok"
          # Give the console a moment to flush, then power off the VM.
          sleep 1
          ${pkgs.systemd}/bin/systemctl poweroff --no-block
        '';
      };
    })
  ];
}
