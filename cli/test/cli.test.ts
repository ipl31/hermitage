import { test, expect } from "bun:test";
import { runCli, type CliDeps } from "../src/cli";

function fakeDeps(overrides: Partial<CliDeps> = {}): CliDeps {
  return {
    log: () => {},
    error: () => {},
    run: async () => ({ code: 0, stdout: "", stderr: "" }),
    ...overrides,
  };
}

test("unknown command returns exit code 2 and prints usage", async () => {
  const lines: string[] = [];
  const code = await runCli(["bogus"], fakeDeps({ error: (m) => lines.push(m) }));
  expect(code).toBe(2);
  expect(lines.join("\n")).toContain("usage: hermit-vm");
});

test("no command prints usage and returns 2", async () => {
  const code = await runCli([], fakeDeps());
  expect(code).toBe(2);
});
