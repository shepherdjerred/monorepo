import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { defineConfig } from "@shepherdjerred/config";
import { APP_HOSTS } from "@shepherdjerred/ops-model/tool-links.ts";
import { CAPTURE_CLI_NAMES } from "#lib/brim/capture/clis.ts";
import { BRIM_SYNC_RECIPIENT } from "#lib/brim/sync/recipient.ts";
import { DEFAULT_CACHE_TTL_SECONDS } from "#lib/credential-cache.ts";
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
  deliveryUrl: {
    schema: z.url({ protocol: /^https?$/ }),
    sources: ["env", "file", "default"],
    default: "https://delivery.tailnet-1a49.ts.net",
  },
  trackerUrl: {
    schema: z.url({ protocol: /^https?$/ }),
    sources: ["env", "file", "default"],
    default: "https://tracker.tailnet-1a49.ts.net",
  },
  trackerActorName: {
    schema: z.string().trim().min(1).max(200),
    sources: ["env", "file", "default"],
    default: "jerred",
  },
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
  /**
   * This machine's id in the Brim sync archive. Unset derives it from the
   * hostname; set it when a hostname is shared or likely to change.
   */
  brimSyncMachineId: {
    schema: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,62}$/)
      .nullable(),
    sources: ["env", "file", "default"],
    default: null,
  },
  /** SeaweedFS bucket that holds the encrypted transcript archive. */
  brimSyncBucket: {
    schema: z.string().min(3).max(63),
    sources: ["env", "file", "default"],
    default: "brim-sessions",
  },
  /** AWS profile with the bucket's endpoint and scoped key. */
  brimSyncProfile: {
    schema: z.string().min(1),
    sources: ["env", "file", "default"],
    default: "brim-sync",
  },
  /**
   * The age X25519 public key every archive object is encrypted to. It is not
   * a secret; the matching identity is the `BRIM_SYNC_AGE_IDENTITY`
   * credential, needed only to pull.
   */
  brimSyncRecipient: {
    schema: z.string().regex(/^age1[0-9a-z]{58}$/),
    sources: ["env", "file", "default"],
    default: BRIM_SYNC_RECIPIENT,
  },
  /**
   * Where `brim sync` gets its S3 keys. `profile` reads them from the AWS
   * profile's credentials file. `broker` resolves them at call time through
   * the toolkit credential broker, for agent hosts that keep no secrets on
   * disk; the profile still supplies the endpoint and region.
   */
  brimSyncS3Credentials: {
    schema: z.enum(["profile", "broker"]),
    sources: ["env", "file", "default"],
    default: "profile",
  },
  /** How many days of other machines' sessions `brim sync pull` mirrors. */
  brimSyncPullSinceDays: {
    schema: z.coerce.number().int().positive(),
    sources: ["env", "file", "default"],
    default: 30,
  },
  /**
   * Route the wrapped agent CLIs through the local capture proxy. Off by
   * default; when on, an agent wrapper refuses to start if the proxy is down.
   */
  brimCaptureEnabled: {
    schema: BooleanSettingSchema,
    sources: ["env", "file", "default"],
    default: false,
  },
  /** Loopback port the capture proxy listens on. */
  brimCapturePort: {
    schema: z.coerce.number().int().min(1024).max(65_535),
    sources: ["env", "file", "default"],
    default: 47_821,
  },
  /** How many days of captured requests the history daemon keeps. */
  brimCaptureRetentionDays: {
    schema: z.coerce.number().int().positive(),
    sources: ["env", "file", "default"],
    default: 30,
  },
  /**
   * Which agent wrappers route through the proxy: a TOML array, or a
   * comma-separated list in the environment. Defaults to the CLIs whose
   * capture is verified.
   */
  brimCaptureClis: {
    schema: z.union([
      z.array(z.enum(CAPTURE_CLI_NAMES)),
      z
        .string()
        .transform((value) =>
          value
            .split(",")
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0),
        )
        .pipe(z.array(z.enum(CAPTURE_CLI_NAMES))),
    ]),
    sources: ["env", "file", "default"],
    default: ["claude", "codex"],
  },
  /**
   * How long the installed toolkit binary serves a 1Password service-account
   * read from its Keychain cache before reading again. Zero disables it.
   */
  credentialCacheTtlSeconds: {
    schema: z.coerce.number().int().nonnegative(),
    sources: ["env", "file", "default"],
    default: DEFAULT_CACHE_TTL_SECONDS,
  },
  /** Base URL of Hub, which serves the ops snapshot. */
  opsDashboardUrl: {
    schema: z.url({ protocol: /^https?$/ }),
    sources: ["env", "file", "default"],
    default: APP_HOSTS.hub,
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
