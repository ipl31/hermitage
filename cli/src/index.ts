#!/usr/bin/env bun
import { runCli, type CliDeps } from "./cli";
import "./commands/up";
import "./commands/status";
import "./commands/logs";
import "./commands/down";
import "./commands/reseed-auth";

const deps: CliDeps = {
  log: (m) => console.log(m),
  error: (m) => console.error(m),
  run: async (cmd, args, opts) => {
    const proc = Bun.spawn([cmd, ...args], {
      cwd: opts?.cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const code = await proc.exited;
    return { code, stdout, stderr };
  },
};

process.exit(await runCli(process.argv.slice(2), deps));
