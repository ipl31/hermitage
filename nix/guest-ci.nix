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
# `vmHostPackages` (optional): point the microvm RUNNER (qemu binary + wrapper)
# at a different host package set than the guest. Used to build a darwin-hosted
# qemu runner for the (aarch64-linux) guest so it can boot under QEMU+TCG on a
# macOS CI runner. Leave null for a native Linux runner.
{ nixpkgs, microvm, system, vmHostPackages ? null }:
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
      } // lib.optionalAttrs (vmHostPackages != null) {
        inherit vmHostPackages;
        # On a darwin host the runner uses accel=hvf:tcg; a CI macOS runner has
        # no Hypervisor.framework, so QEMU falls back to TCG. Under TCG `-cpu
        # host` is invalid, so pin a concrete CPU (this also drops -enable-kvm).
        cpu = "cortex-a72";
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
