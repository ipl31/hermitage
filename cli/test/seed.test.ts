import { test, expect } from "bun:test";
import { parseSeed, SeedError } from "../src/seed";

const valid = `
name: my-hermit
agent_name: Hermit
timezone: America/New_York
channels:
  discord:
    enabled: true
    channel_id: "123"
    allowed_users: ["456"]
hatch_prompt: "set yourself up"
`;

test("parses a valid seed", () => {
  const s = parseSeed(valid);
  expect(s.name).toBe("my-hermit");
  expect(s.channels?.discord?.channel_id).toBe("123");
  expect(s.hatch_prompt).toBe("set yourself up");
});

test("rejects a seed missing required fields", () => {
  expect(() => parseSeed("agent_name: x")).toThrow(SeedError);
});

test("rejects a name that is not a safe directory token", () => {
  expect(() => parseSeed("name: ../evil\nagent_name: x\ntimezone: UTC")).toThrow(SeedError);
});
