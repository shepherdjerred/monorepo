// Driver-feed configuration: the `[driver_feed]` schema and its deployment overrides.
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

/** The `[driver_feed]` section each game embeds in its config schema. */
export type DriverFeedConfig = z.infer<typeof DriverFeedConfigSchema>;
export const DriverFeedConfigSchema = z
  .strictObject({
    // Off by default — turning it on starts a second ffmpeg process. Opt in per
    // deployment once the uplink has been measured against `bitrate_kbps`.
    enabled: z.boolean().default(false),
    // Height of the square-pixel image sent to the browser; each game scales its
    // framebuffer to its display aspect at this height (MK 4:3 -> 640x480, GBA 3:2
    // -> 720x480), so the client can paint it without correcting the aspect itself.
    height: z.number().int().min(120).max(1080).default(480),
    bitrate_kbps: z.number().int().positive().default(2500),
    bitrate_max_kbps: z.number().int().positive().default(4000),
    // Keyframe cadence in frames. Every IDR costs a bitrate spike on a TCP
    // socket, but it is also the only resync point for a client the hub had to
    // drop delta units from. 30 frames = ~1 s at 30 fps, ~0.5 s at the GBA's ~60 fps.
    keyframe_interval_frames: z.number().int().min(1).max(600).default(30),
    // Per-client socket backlog ceiling. Past this the hub drops delta units and
    // resyncs that client at the next keyframe instead of queueing without
    // bound — the failure mode that reached 3.47 GB against a 4 GiB pod limit on
    // the Go-Live path (archive/completed/2026-06-19_mk64-stream-backpressure.md).
    // Every queued byte is also latency on a driver's screen: 128 KiB is ~0.4 s
    // at 2500 kbps and still fits a keyframe, where 2 MiB allowed ~6.7 s.
    max_client_buffer_bytes: z
      .number()
      .int()
      .min(64 * 1024)
      .default(128 * 1024),
    // Concurrent viewers. Each one costs a full copy of the stream on the
    // uplink, so this is a bandwidth guard, not a memory one.
    max_clients: z.number().int().min(1).max(32).default(8),
  })
  .prefault({});

/**
 * An index signature rather than named optional keys: `Bun.env` carries one, and
 * TypeScript's weak-type check rejects assigning it to an all-optional object.
 */
export type DriverFeedEnv = Readonly<Record<string, string | undefined>>;

/**
 * Booleans accept only their exact spellings. Unset leaves the file value
 * alone; a misspelled incident override must fail fast instead of silently
 * disabling or enabling the feed.
 */
function overrideFlag(
  name: string,
  raw: string | undefined,
  fallback: boolean,
): boolean {
  if (raw === undefined) return fallback;
  const parsed = z.enum(["true", "false"]).safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `${name} must be "true" or "false", got ${JSON.stringify(raw)}`,
    );
  }
  return parsed.data === "true";
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
    enabled: overrideFlag(
      "DRIVER_FEED_ENABLED",
      env["DRIVER_FEED_ENABLED"],
      fileConfig.enabled,
    ),
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

/** The game's `[stream.video]` encoder settings the driver feed reuses. */
export type StreamVideoEncoderConfig = {
  readonly hardware_acceleration: boolean;
  readonly vaapi_device: string;
  readonly encoder_async_depth: number;
};

/**
 * Encoder settings for the feed: the Go-Live stream's GPU and latency knobs,
 * with the same STREAM_HARDWARE_ACCELERATION / VAAPI_DEVICE overrides the
 * Go-Live path reads at its consumption site.
 */
export function resolveDriverFeedVideo(
  video: StreamVideoEncoderConfig,
  env: DriverFeedEnv,
): StreamVideoEncoderConfig {
  return {
    hardware_acceleration:
      env["STREAM_HARDWARE_ACCELERATION"] === "true" ||
      video.hardware_acceleration,
    vaapi_device: env["VAAPI_DEVICE"] ?? video.vaapi_device,
    encoder_async_depth: video.encoder_async_depth,
  };
}
