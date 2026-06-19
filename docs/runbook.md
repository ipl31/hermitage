# Runbook: deploy a live Hermit

1. Prereqs: aarch64-linux builder OK (`nix build nixpkgs#hello --system aarch64-linux`).
2. Real `seed.yaml` with `channels.discord.enabled: true`, a real `channel_id`,
   `allowed_users`, and a `hatch_prompt` ending in "announce readiness in Discord".
3. Real `secrets.env`: ONE of `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN`,
   plus `DISCORD_BOT_TOKEN` and `GH_TOKEN`.
4. `nix run .#hermit-vm -- up seed.yaml --secrets secrets.env`
   - Watch phases: `hermit-vm status <name>` cycles auth→channels→plugins→hatching→running.
   - Tail detail: `hermit-vm logs <name>`.
5. First-time Discord pairing (interactive, one time): DM the bot; in its DM run
   `/discord:access pair <code>`. Subsequent boots reuse `access.json`.
6. Confirm the agent posts a readiness message in the channel.
7. Rotate auth without downtime: `hermit-vm reseed-auth <name> --secrets new.env`.
8. Re-run setup: `hermit-vm up seed.yaml --secrets secrets.env --rehatch`.
9. Tear down: `hermit-vm down <name>` (keep state) or `--wipe` (delete it).

## Troubleshooting
- `phase: error` → `hermit-vm logs <name>`; common: bad auth, or hatch failed to
  create `bin/hermit-start` (re-run with `--rehatch`).
- Agent crash-looping → check `agent.env` auth validity; `reseed-auth` if expired.
