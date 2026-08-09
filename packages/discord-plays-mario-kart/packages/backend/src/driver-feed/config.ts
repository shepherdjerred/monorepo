// Deployment overrides for the driver feed.
//
// The live config.toml is a 1Password item, so anything an operator might need
// to change during an incident must be reachable from the Deployment instead.
// Two things qualify: the master switch, and the bandwidth knobs — the homelab's
// upstream capacity is undocumented and unmeasured, so these values are declared
// in GitOps rather than buried in the vault. Change the Deployment source and let
// ArgoCD reconcile it; never mutate the live Deployment during an incident.
//
// Mirrors how the Go-Live path already takes STREAM_HARDWARE_ACCELERATION and
// VAAPI_DEVICE from the environment at the consumption site.

import { z } from "zod";
import type { Config } from "#src/config/schema.ts";

type DriverFeedConfig = Config["driver_feed"];

/**
 * An index signature rather than named optional keys: `Bun.env` carries one, and
 * TypeScript's weak-type check rejects assigning it to an all-optional object.
 */
export type DriverFeedEnv = Readonly<Record<string, string | undefined>>;

/**
 * Booleans follow the existing convention: the string "true" enables, anything
 * else present disables. Unset leaves the file value alone, so an operator can
 * force the feed off without knowing what the config says.
 */
function overrideFlag(raw: string | undefined, fallback: boolean): boolean {
  return raw === undefined ? fallback : raw === "true";
}

/**
 * Numbers fail fast rather than silently falling back: a typo'd bitrate that
 * quietly kept the old value would be discovered by watching the uplink
 * saturate, which is exactly the situation the override exists to fix.
 */
function overrideNumber(
  name: string,
  raw: string | undefined,
  fallback: number,
  schema: z.ZodType<number>,
): number {
  if (raw === undefined) return fallback;
  const parsed = schema.safeParse(Number(raw));
  if (!parsed.success) {
    throw new Error(
      `${name} must be a valid value, got ${JSON.stringify(raw)}: ${parsed.error.issues[0]?.message ?? "invalid"}`,
    );
  }
  return parsed.data;
}

/** Apply environment overrides on top of the file config. */
export function resolveDriverFeedConfig(
  fileConfig: DriverFeedConfig,
  env: DriverFeedEnv,
): DriverFeedConfig {
  return {
    ...fileConfig,
    enabled: overrideFlag(env["DRIVER_FEED_ENABLED"], fileConfig.enabled),
    bitrate_kbps: overrideNumber(
      "DRIVER_FEED_BITRATE_KBPS",
      env["DRIVER_FEED_BITRATE_KBPS"],
      fileConfig.bitrate_kbps,
      z.number().int().positive(),
    ),
    max_clients: overrideNumber(
      "DRIVER_FEED_MAX_CLIENTS",
      env["DRIVER_FEED_MAX_CLIENTS"],
      fileConfig.max_clients,
      z.number().int().min(1).max(32),
    ),
  };
}
