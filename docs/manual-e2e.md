# Manual end-to-end (macOS, Apple Silicon)

1. Confirm the builder: `nix build nixpkgs#hello --system aarch64-linux`
2. Create a real secrets file `./secrets.env` with `ANTHROPIC_API_KEY=...` and
   `DISCORD_BOT_TOKEN=...` (values are unused by Plan 1 but exercise rendering).
3. Bring it up:
   `nix run .#hermit-vm -- up docs/seed.example.yaml --secrets ./secrets.env`
   Expect: "✅ my-hermit is ready."
4. Verify status: `nix run .#hermit-vm -- status my-hermit` → phase: ready
5. Verify the plumbing:
   - `cat ~/.local/share/hermit-vm/my-hermit/runtime/status.json` → `"phase":"ready"`
   - `ls ~/.local/share/hermit-vm/my-hermit/state.img` exists (auto-created)
6. Tear down: `nix run .#hermit-vm -- down my-hermit --wipe`
   Expect: VM stops via the control socket; state dir removed.
