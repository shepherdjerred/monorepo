import type { DenonConfig } from "https://deno.land/x/denon@2.5.0/mod.ts";

export const config: DenonConfig = {
  scripts: {
    check: {
      cmd: "deno task check",
    },
  },
  watcher: {
    interval: 1000,
  },
};

export default config;
