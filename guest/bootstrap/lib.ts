import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[k] = v;
  }
  return env;
}

export function readEnvFiles(dir: string): Record<string, string> {
  if (!existsSync(dir)) return {};
  const out: Record<string, string> = {};
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".env")) continue;
    Object.assign(out, parseEnv(readFileSync(join(dir, f), "utf8")));
  }
  return out;
}

export function resolveAuth(env: Record<string, string>): {
  authEnv: Record<string, string>; credsSource?: string; warning?: string;
} {
  if (env.ANTHROPIC_API_KEY) return { authEnv: { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY } };
  if (env.CLAUDE_CODE_OAUTH_TOKEN) return { authEnv: { CLAUDE_CODE_OAUTH_TOKEN: env.CLAUDE_CODE_OAUTH_TOKEN } };
  if (env.CLAUDE_OAUTH_CREDS) {
    return {
      authEnv: {},
      credsSource: env.CLAUDE_OAUTH_CREDS,
      warning: "copied OAuth credentials may not auto-refresh on a headless VM; prefer CLAUDE_CODE_OAUTH_TOKEN",
    };
  }
  throw new Error("no Claude auth found in seed secrets");
}

export function claudeJson(version: string, projectDir: string, mcpServers: string[]): object {
  return {
    hasCompletedOnboarding: true,
    lastOnboardingVersion: version,
    projects: { [projectDir]: { hasTrustDialogAccepted: true, hasTrustDialogHooksAccepted: true } },
    enabledMcpjsonServers: mcpServers,
  };
}

export function agentEnvContent(vars: Record<string, string>): string {
  return Object.entries(vars).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
}
