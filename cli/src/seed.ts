import { parse } from "yaml";

export class SeedError extends Error {}

export interface DiscordChannel {
  enabled: boolean;
  channel_id: string;
  allowed_users?: string[];
  morning_brief?: string;
}
export interface Seed {
  name: string;
  agent_name: string;
  timezone: string;
  channels?: { discord?: DiscordChannel };
  routines?: unknown[];
  hatch_prompt?: string;
  secrets_file?: string;
}

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function parseSeed(text: string): Seed {
  let raw: unknown;
  try { raw = parse(text); } catch (e) { throw new SeedError(`invalid YAML: ${e}`); }
  if (typeof raw !== "object" || raw === null) throw new SeedError("seed must be a mapping");
  const o = raw as Record<string, unknown>;

  const req = (k: string): string => {
    const v = o[k];
    if (typeof v !== "string" || v.length === 0) throw new SeedError(`missing required field: ${k}`);
    return v;
  };

  const name = req("name");
  if (!NAME_RE.test(name)) throw new SeedError(`name must match ${NAME_RE} (got '${name}')`);

  return {
    name,
    agent_name: req("agent_name"),
    timezone: req("timezone"),
    channels: o.channels as Seed["channels"],
    routines: Array.isArray(o.routines) ? o.routines : undefined,
    hatch_prompt: typeof o.hatch_prompt === "string" ? o.hatch_prompt : undefined,
    secrets_file: typeof o.secrets_file === "string" ? o.secrets_file : undefined,
  };
}
