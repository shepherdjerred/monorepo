import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { defineConfig } from "@shepherdjerred/config";
import { createObservabilityHooks } from "@shepherdjerred/config/observability.ts";
import { createEnvSource } from "@shepherdjerred/config/sources/env.ts";
import { createFileSource } from "@shepherdjerred/config/sources/file.ts";
import type { Environment } from "@shepherdjerred/config/sources/env.ts";

/**
 * Layered toolkit settings: `env -> ~/.toolkit/config.toml -> default`.
 *
 * Toolkit runs on a workstation, not in the cluster, so there is no flag
 * layer: the Flipt client is cluster-internal and toolkit does not carry
 * `@shepherdjerred/feature-flags`. The file layer exists because the history
 * daemon runs under launchd, whose plist carries no environment; a TOML file
 * is the durable way to turn behavior on for it.
 *
 * Environment and file values arrive as strings or TOML scalars, so booleans
 * accept either a real boolean (TOML) or a boolean string (env).
 */
const BooleanSettingSchema = z.union([z.boolean(), z.stringbool()]);

export const TOOLKIT_CONFIG_DEFINITION = {
  /** Push local AI usage and Brim quota metrics to the homelab. */
  historyMetricsPushEnabled: {
    schema: BooleanSettingSchema,
    sources: ["env", "file", "default"],
    default: false,
  },
  /** OTLP/HTTP metrics endpoint the history daemon pushes to. */
  historyMetricsPushEndpoint: {
    schema: z.url({ protocol: /^https?$/ }),
    sources: ["env", "file", "default"],
    default: "https://otlp-metrics.tailnet-1a49.ts.net/v1/metrics",
  },
  /** Base URL of the ops dashboard that serves the ops snapshot. */
  opsDashboardUrl: {
    schema: z.url({ protocol: /^https?$/ }),
    sources: ["env", "file", "default"],
    default: "https://ops.tailnet-1a49.ts.net",
  },
} as const;

export function defaultToolkitConfigPath(home: string = os.homedir()): string {
  return path.join(home, ".toolkit/config.toml");
}

export type ToolkitConfigOptions = {
  /** Defaults to `Bun.env`. */
  readonly environment?: Environment;
  /** Defaults to `~/.toolkit/config.toml`; a missing file is absent. */
  readonly configPath?: string;
};

export async function loadToolkitConfig(options: ToolkitConfigOptions = {}) {
  return defineConfig({
    definition: TOOLKIT_CONFIG_DEFINITION,
    sources: {
      env: createEnvSource(options.environment ?? Bun.env),
      file: await createFileSource({
        path: options.configPath ?? defaultToolkitConfigPath(),
      }),
    },
    hooks: createObservabilityHooks({
      log: (message) => {
        console.warn(`[config] ${message}`);
      },
    }),
  });
}

export type ToolkitConfig = Awaited<ReturnType<typeof loadToolkitConfig>>;
