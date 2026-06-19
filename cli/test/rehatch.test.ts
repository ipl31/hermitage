import { test, expect } from "bun:test";
import { wantsRehatch } from "../src/commands/up";

test("detects --rehatch flag", () => {
  expect(wantsRehatch(["seed.yaml", "--rehatch"])).toBe(true);
  expect(wantsRehatch(["seed.yaml"])).toBe(false);
});
