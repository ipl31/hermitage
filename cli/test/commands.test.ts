import { test, expect } from "bun:test";
import { runCli, type CliDeps } from "../src/cli";
import "../src/commands/up";        // registers the command
import "../src/commands/status";
import "../src/commands/logs";
import "../src/commands/down";
import { parseUpArgs } from "../src/commands/up";

const noop: CliDeps = {
  log: () => {}, error: () => {},
  run: async () => ({ code: 0, stdout: "", stderr: "" }),
};

test("up with no seed path errors", async () => {
  const errs: string[] = [];
  const code = await runCli(["up"], { ...noop, error: (m) => errs.push(m) });
  expect(code).toBe(2);
  expect(errs.join("\n")).toContain("up: missing <seed.yaml>");
});

// parseUpArgs unit tests
test("parseUpArgs: seed then --secrets", () => {
  const r = parseUpArgs(["seed.yaml", "--secrets", "s.env"]);
  expect(r.seedPath).toBe("seed.yaml");
  expect(r.secretsPath).toBe("s.env");
});

test("parseUpArgs: --secrets first then seed", () => {
  const r = parseUpArgs(["--secrets", "s.env", "seed.yaml"]);
  expect(r.seedPath).toBe("seed.yaml");
  expect(r.secretsPath).toBe("s.env");
});

test("parseUpArgs: no positional gives seedPath undefined", () => {
  const r = parseUpArgs(["--secrets", "s.env"]);
  expect(r.seedPath).toBeUndefined();
  expect(r.secretsPath).toBe("s.env");
});

test("parseUpArgs: unknown flags are ignored", () => {
  const r = parseUpArgs(["--rehatch", "seed.yaml", "--secrets", "s.env"]);
  expect(r.seedPath).toBe("seed.yaml");
  expect(r.secretsPath).toBe("s.env");
});
