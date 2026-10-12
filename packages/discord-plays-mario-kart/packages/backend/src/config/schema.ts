import { z } from "zod";
import { DriverFeedConfigSchema } from "@shepherdjerred/discord-plays-core/driver-feed/config.ts";
import {
  botConfigFields,
  gameConfigRootFields,
  notificationsConfigFields,
  streamConfigFields,
  streamVideoConfigFields,
} from "@shepherdjerred/discord-plays-core/config/game-config.ts";

export type Config = z.infer<typeof ConfigSchema>;
export const ConfigSchema = z.strictObject({
  ...gameConfigRootFields,
  bot: z.strictObject({
    ...botConfigFields,
    notifications: z.strictObject(notificationsConfigFields),
  }),
  stream: z.strictObject({
    ...streamConfigFields,
    video: z.strictObject({
      ...streamVideoConfigFields,
      // Realtime latency opt-ins in the discord-video-stream fork: per-packet
      // muxer flush and low-delay Opus (10 ms frames). On by default for this
      // realtime consumer; disable individually when A/B-isolating a change.
      low_latency_mux: z.boolean().default(true),
      low_delay_audio: z.boolean().default(true),
      // Ceiling advertised to viewers via the `playout-delay` RTP header
      // extension. Chrome sizes its jitter buffer up to this value and, on a
      // clean link, sits at the ceiling — press-to-glass measurement on
      // 2026-08-03 found ~92 ms of client buffering against the fork's
      // historical 100 ms cap, with zero packet loss. Lower means less input
      // lag but less jitter absorbed before a visible freeze.
      video_playout_delay_max_ms: z
        .number()
        .int()
        .min(0)
        .max(40_950)
        .default(100),
    }),
  }),
  // The game: the native SpaghettiKart port (see [spaghettikart]).
  emulator: z.strictObject({
    // false: nothing is prepared at startup and `/play` is refused (the
    // ROM-free image smoke runs this way).
    enabled: z.boolean(),
    // Path to the Mario Kart 64 ROM (.z64), the US cart. Provided at runtime
    // via a volume — never baked into the image. Copyrighted; you supply your
    // own. The game's asset archive is extracted from it at startup.
    rom_path: z.string().min(1),
    // @deprecated Settings of the retired wasm emulator. Accepted, unread, so
    // the live config.toml (a 1Password item) keeps validating until it drops
    // them.
    wasm_dir: z.string().min(1).optional(),
    fps: z.number().positive().optional(),
    software_render: z.boolean().optional(),
    // Number of web-controller seats to expose (MK64 supports up to 4).
    seats: z.number().int().min(1).max(4).default(4),
  }),
  // The native SpaghettiKart build. Defaulted so existing config.toml files
  // keep validating.
  spaghettikart: z
    .strictObject({
      // Build output: the game binary, spaghetti.o2r, Torch, and Torch's
      // extraction inputs, described by install.json. The image ships it at
      // the default path; `bun run build:spaghetti` writes .cache/spaghetti/dist.
      install_dir: z
        .string()
        .min(1)
        .default("packages/backend/assets/spaghettikart"),
      // Frames per second sent to the stream and driver feed. Game logic stays
      // at 30 Hz; 60 adds the port's interpolated frames between logic frames.
      output_fps: z.union([z.literal(30), z.literal(60)]).default(30),
    })
    .prefault({}),
  web: z.strictObject({
    enabled: z.boolean(),
    cors: z.boolean(),
    port: z
      .number()
      .nonnegative()
      .min(1024, "Ports below 1024 are reserved")
      .max(49_151, "Ports above 49151 are reserved"),
    assets: z.string(),
    api: z.strictObject({
      enabled: z.boolean(),
    }),
  }),
  // Race-result leaderboards + per-player name burn-in. The whole block has a
  // default so existing config.toml files (1Password) keep validating before
  // the `[leaderboard]` section is added.
  leaderboard: z
    .strictObject({
      // Master switch: race recording + the leaderboard API.
      enabled: z.boolean().default(false),
      // SQLite file path; overridden by DATABASE_PATH / DATABASE_URL env.
      db_path: z.string().min(1).default("data/leaderboard.db"),
      // Burn player names into the stream at each viewport corner.
      overlay_enabled: z.boolean().default(true),
      // Race-state snapshot cadence in game frames (~3 Hz at 30 fps).
      poll_every_n_frames: z.number().int().min(1).max(60).default(10),
    })
    // prefault (not default): run `{}` through the schema so the inner field
    // defaults apply when the whole [leaderboard] block is omitted.
    .prefault({}),
  // Low-latency in-browser video for the people actually driving. Spectators keep
  // watching the Discord Go-Live stream unchanged; drivers additionally receive
  // H.264 access units over a WebSocket and decode them in the controller page,
  // skipping Discord's voice leg and its ~85 ms client de-jitter buffer — the
  // largest remaining term in the press-to-glass budget as of 2026-08-03.
  //
  // Same `.prefault({})` treatment as [leaderboard], and for the same reason: the
  // live config.toml is a 1Password secret, so a required section would crash-loop
  // the pod until someone edits the vault.
  driver_feed: DriverFeedConfigSchema,
});
