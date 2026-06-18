import { test, expect } from "bun:test";
import { buildRunner } from "../src/vm";
import type { CliDeps } from "../src/cli";

test("buildRunner invokes nix build of the declaredRunner and returns the path", async () => {
  let seen = "";
  const deps: CliDeps = {
    log: () => {}, error: () => {},
    run: async (cmd, args) => {
      seen = [cmd, ...args].join(" ");
      return { code: 0, stdout: "/nix/store/abc-microvm-run\n", stderr: "" };
    },
  };
  const path = await buildRunner(deps);
  expect(seen).toContain("nix build .#nixosConfigurations.hermit.config.microvm.declaredRunner");
  expect(seen).toContain("--print-out-paths");
  expect(path).toBe("/nix/store/abc-microvm-run");
});

test("buildRunner throws on nix failure", async () => {
  const deps: CliDeps = {
    log: () => {}, error: () => {},
    run: async () => ({ code: 1, stdout: "", stderr: "eval error" }),
  };
  await expect(buildRunner(deps)).rejects.toThrow("eval error");
});
