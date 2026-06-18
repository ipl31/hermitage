import { test, expect } from "bun:test";
import { mkdtempSync, statSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stateDir } from "../src/state";
import { renderHostState } from "../src/render";
import { parseSeed } from "../src/seed";
import { parseSecrets } from "../src/secrets";

test("renders config.json and secrets with correct perms", async () => {
  const home = mkdtempSync(join(tmpdir(), "hv-"));
  const paths = stateDir("my-hermit", home);
  const seed = parseSeed("name: my-hermit\nagent_name: Hermit\ntimezone: UTC\nhatch_prompt: hi");
  const secrets = parseSecrets("ANTHROPIC_API_KEY=sk-ant-x\nDISCORD_BOT_TOKEN=tok");

  await renderHostState(paths, seed, secrets);

  expect(paths.root).toBe(join(home, ".local/share/hermit-vm/my-hermit"));
  expect(existsSync(paths.runtime)).toBe(true);

  const cfg = JSON.parse(readFileSync(join(paths.seed, "config.json"), "utf8"));
  expect(cfg.agent_name).toBe("Hermit");
  expect(cfg.hatch_prompt).toBe("hi");
  expect(cfg.anthropic_api_key).toBeUndefined(); // secrets never in config.json

  const secDir = join(paths.seed, "secrets");
  expect(statSync(secDir).mode & 0o777).toBe(0o700);
  expect(statSync(join(secDir, "anthropic.env")).mode & 0o777).toBe(0o600);
  expect(readFileSync(join(secDir, "discord.env"), "utf8")).toContain("DISCORD_BOT_TOKEN=tok");
});

test("render routes multi-service secrets to correct env files", async () => {
  const home = mkdtempSync(join(tmpdir(), "hv-"));
  const paths = stateDir("route-test", home);
  const seed = parseSeed("name: route-test\nagent_name: Hermit\ntimezone: UTC\nhatch_prompt: hi");
  // Only ANTHROPIC_API_KEY as auth source (parseSecrets requires exactly one)
  const secrets = parseSecrets(
    "ANTHROPIC_API_KEY=sk-ant-x\nDISCORD_BOT_TOKEN=dtok\nGH_TOKEN=ghtoken\nEXTRA_FOO=bar"
  );

  await renderHostState(paths, seed, secrets);

  const secDir = join(paths.seed, "secrets");

  // github.env must contain GH_TOKEN
  const githubEnv = readFileSync(join(secDir, "github.env"), "utf8");
  expect(githubEnv).toContain("GH_TOKEN=ghtoken");
  expect(statSync(join(secDir, "github.env")).mode & 0o777).toBe(0o600);

  // extra.env must contain EXTRA_FOO
  const extraEnv = readFileSync(join(secDir, "extra.env"), "utf8");
  expect(extraEnv).toContain("EXTRA_FOO=bar");
  expect(statSync(join(secDir, "extra.env")).mode & 0o777).toBe(0o600);
});
