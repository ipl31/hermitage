import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stateDir } from "../src/state";
import { readStatus, pollStatus } from "../src/status";

test("readStatus returns null when missing", async () => {
  const home = mkdtempSync(join(tmpdir(), "hv-"));
  expect(await readStatus(stateDir("x", home))).toBeNull();
});

test("readStatus parses status.json", async () => {
  const home = mkdtempSync(join(tmpdir(), "hv-"));
  const p = stateDir("x", home);
  mkdirSync(p.runtime, { recursive: true });
  writeFileSync(p.statusFile, JSON.stringify({ phase: "ready", name: "x", ts: 1 }));
  const s = await readStatus(p);
  expect(s?.phase).toBe("ready");
});

test("pollStatus resolves when target phase appears", async () => {
  const home = mkdtempSync(join(tmpdir(), "hv-"));
  const p = stateDir("x", home);
  mkdirSync(p.runtime, { recursive: true });
  setTimeout(() => writeFileSync(p.statusFile, JSON.stringify({ phase: "ready" })), 50);
  const s = await pollStatus(p, "ready", 2000);
  expect(s?.phase).toBe("ready");
});
