import { loadIngestConfig } from "@swarmcast/config/env";

export function loadConfig(env = process.env, options = {}) {
  return Object.freeze(loadIngestConfig(env, options));
}

export const config = loadConfig();
