import { test, expect } from "bun:test";
import { successPhase } from "../src/commands/up";

test("classifies phases", () => {
  expect(successPhase({ phase: "running" })).toBe("ok");
  expect(successPhase({ phase: "awaiting_pairing" })).toBe("pair");
  expect(successPhase({ phase: "error", error: "x" })).toBe("fail");
  expect(successPhase(null)).toBe("fail");
});
