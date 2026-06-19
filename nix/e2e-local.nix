# Single-command local E2E for macOS bare metal.
#
# `nix run .#e2e-local` builds the microVM guest (via the local linux-builder)
# and boots it with the REAL vfkit hypervisor (Apple Virtualization.framework) —
# the actual product path, which works on bare-metal Apple Silicon (unlike the
# hosted-CI runners, which are limited to QEMU/TCG). It waits for the readiness
# marker on the console, then confirms the guest powered itself off (teardown).
{ writeShellApplication, coreutils, gnugrep, runner }:
writeShellApplication {
  name = "hermit-e2e-local";
  runtimeInputs = [ coreutils gnugrep ];
  text = ''
    set -uo pipefail
    echo "Hermit local E2E — booting the microVM via vfkit (real Virtualization.framework)…"
    workdir="$(mktemp -d)"; cd "$workdir"
    log="$workdir/boot.log"

    # vfkit's stdio console requires a real TTY; we capture to a file, so wrap
    # the runner in a pseudo-TTY via macOS's BSD `script` (writes to $log).
    /usr/bin/script -q "$log" "${runner}/bin/microvm-run" >/dev/null 2>&1 &
    pid=$!
    ready=0; self_exit=0
    for _ in $(seq 1 120); do          # up to 120 * 5s = 600s
      if grep -q "HERMIT_CI_VM_READY" "$log"; then ready=1; fi
      if ! kill -0 "$pid" 2>/dev/null; then self_exit=1; break; fi
      [ "$ready" = 1 ] && break
      sleep 5
    done
    # let a self-powering-off guest exit cleanly
    if [ "$self_exit" = 0 ]; then
      for _ in $(seq 1 12); do kill -0 "$pid" 2>/dev/null || { self_exit=1; break; }; sleep 5; done
    fi
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true

    echo "----- boot.log (tail) -----"; tail -40 "$log" || true
    echo "---------------------------"
    grep -q "HERMIT_CI_VM_READY" "$log" || { echo "FAIL: readiness marker not found"; exit 1; }
    echo "readiness: OK; self-powered-off (clean teardown): $([ "$self_exit" = 1 ] && echo yes || echo 'no — killed')"
    echo "PASS: microVM booted via vfkit on macOS bare metal"
  '';
}
