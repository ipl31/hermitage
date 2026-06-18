import { test, expect } from "bun:test";
import { preflight } from "../src/preflight";
import type { CliDeps, RunResult } from "../src/cli";

function depsFor(table: Record<string, RunResult>): CliDeps {
  return {
    log: () => {}, error: () => {},
    run: async (cmd, args) => {
      const key = [cmd, ...args].join(" ");
      for (const [prefix, res] of Object.entries(table)) {
        if (key.startsWith(prefix)) return res;
      }
      return { code: 127, stdout: "", stderr: "not found" };
    },
  };
}
const ok: RunResult = { code: 0, stdout: "", stderr: "" };
const fail: RunResult = { code: 1, stdout: "", stderr: "boom" };

test("all good -> ok", async () => {
  const r = await preflight(depsFor({
    "nix --version": { code: 0, stdout: "nix (Nix) 2.24", stderr: "" },
    "nix build nixpkgs#hello --system aarch64-linux": ok,
    "nix build nixpkgs#vfkit": ok,
  }));
  expect(r.ok).toBe(true);
  expect(r.problems).toHaveLength(0);
});

test("missing linux-builder -> problem with remediation", async () => {
  const r = await preflight(depsFor({
    "nix --version": { code: 0, stdout: "nix (Nix) 2.24", stderr: "" },
    "nix build nixpkgs#hello --system aarch64-linux": fail,
    "nix build nixpkgs#vfkit": ok,
  }));
  expect(r.ok).toBe(false);
  expect(r.problems.join("\n")).toContain("nix.linux-builder.enable");
});
