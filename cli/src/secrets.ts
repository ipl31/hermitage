export class SecretsError extends Error {}

export type AuthMode = "apikey" | "oauth-token" | "oauth-creds";
export interface Secrets { env: Record<string, string>; authMode: AuthMode; }

export function parseSecrets(text: string): Secrets {
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) throw new SecretsError(`invalid line (no '='): ${t}`);
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }

  const sources: AuthMode[] = [];
  if (env.ANTHROPIC_API_KEY) sources.push("apikey");
  if (env.CLAUDE_CODE_OAUTH_TOKEN) sources.push("oauth-token");
  if (env.CLAUDE_OAUTH_CREDS) sources.push("oauth-creds");
  if (sources.length === 0) {
    throw new SecretsError("no Claude auth: set one of ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN, CLAUDE_OAUTH_CREDS");
  }
  if (sources.length > 1) {
    throw new SecretsError(`multiple Claude auth sources (${sources.join(", ")}); set exactly one`);
  }
  return { env, authMode: sources[0]! };
}
