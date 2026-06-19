import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readEnvFiles, resolveAuth, claudeJson, agentEnvContent } from "./lib";

test("readEnvFiles merges *.env files", () => {
  const d = mkdtempSync(join(tmpdir(), "s-"));
  writeFileSync(join(d, "anthropic.env"), "ANTHROPIC_API_KEY=k\n# c\n");
  writeFileSync(join(d, "discord.env"), 'DISCORD_BOT_TOKEN="t"\n');
  const env = readEnvFiles(d);
  expect(env.ANTHROPIC_API_KEY).toBe("k");
  expect(env.DISCORD_BOT_TOKEN).toBe("t");
});

test("resolveAuth: api key", () => {
  const r = resolveAuth({ ANTHROPIC_API_KEY: "k" });
  expect(r.authEnv.ANTHROPIC_API_KEY).toBe("k");
  expect(r.credsSource).toBeUndefined();
});

test("resolveAuth: oauth token", () => {
  const r = resolveAuth({ CLAUDE_CODE_OAUTH_TOKEN: "tok" });
  expect(r.authEnv.CLAUDE_CODE_OAUTH_TOKEN).toBe("tok");
});

test("resolveAuth: oauth creds returns source + warning", () => {
  const r = resolveAuth({ CLAUDE_OAUTH_CREDS: "/run/hermit-seed/secrets/creds.json" });
  expect(r.credsSource).toBe("/run/hermit-seed/secrets/creds.json");
  expect(r.warning).toContain("refresh");
});

test("claudeJson sets onboarding + trust + mcp", () => {
  const j = claudeJson("2.1.179", "/var/lib/hermit/project", ["discord"]) as any;
  expect(j.hasCompletedOnboarding).toBe(true);
  expect(j.lastOnboardingVersion).toBe("2.1.179");
  expect(j.projects["/var/lib/hermit/project"].hasTrustDialogAccepted).toBe(true);
  expect(j.enabledMcpjsonServers).toEqual(["discord"]);
});

test("agentEnvContent serializes", () => {
  expect(agentEnvContent({ A: "1", B: "2" })).toBe("A=1\nB=2\n");
});
