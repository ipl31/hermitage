import { test, expect } from "bun:test";
import { rewriteAuth } from "../src/commands/reseed-auth";

test("rewriteAuth replaces auth keys, preserves others", () => {
  const current = "ANTHROPIC_API_KEY=old\nGH_TOKEN=gh\nDISCORD_BOT_TOKEN=d\n";
  const out = rewriteAuth(current, { CLAUDE_CODE_OAUTH_TOKEN: "new" });
  expect(out).toContain("CLAUDE_CODE_OAUTH_TOKEN=new");
  expect(out).not.toContain("ANTHROPIC_API_KEY=old");
  expect(out).toContain("GH_TOKEN=gh");
  expect(out).toContain("DISCORD_BOT_TOKEN=d");
});
