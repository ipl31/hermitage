import { test, expect } from "bun:test";
import { parseSecrets, SecretsError } from "../src/secrets";

test("parses an env file with an API key", () => {
  const s = parseSecrets("ANTHROPIC_API_KEY=sk-ant-x\nDISCORD_BOT_TOKEN=tok\n# comment\n");
  expect(s.authMode).toBe("apikey");
  expect(s.env.DISCORD_BOT_TOKEN).toBe("tok");
});

test("detects an oauth token", () => {
  expect(parseSecrets("CLAUDE_CODE_OAUTH_TOKEN=abc").authMode).toBe("oauth-token");
});

test("rejects zero auth sources", () => {
  expect(() => parseSecrets("DISCORD_BOT_TOKEN=tok")).toThrow(SecretsError);
});

test("rejects two auth sources", () => {
  expect(() => parseSecrets("ANTHROPIC_API_KEY=a\nCLAUDE_CODE_OAUTH_TOKEN=b")).toThrow(SecretsError);
});
