import { readFile } from "node:fs/promises";
import type { VmPaths } from "./state";

export interface Status { phase: string; name?: string; ts?: number; error?: string; }

export async function readStatus(paths: VmPaths): Promise<Status | null> {
  try {
    const txt = await readFile(paths.statusFile, "utf8");
    return JSON.parse(txt) as Status;
  } catch { return null; }
}

export async function pollStatus(paths: VmPaths, until: string, timeoutMs: number): Promise<Status | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await readStatus(paths);
    if (s && (s.phase === until || s.phase === "error" || s.phase === "crashlooping" || s.phase === "awaiting_pairing")) return s;
    await new Promise((r) => setTimeout(r, 500));
  }
  return readStatus(paths);
}
