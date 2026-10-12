import { z } from "zod";

export type Config = z.infer<typeof ConfigSchema>;
export const ConfigSchema = z
  .strictObject({
    /**
     * Legacy single-tenant guild id. MK64 is multi-tenant now — the active session's
     * guildId comes from the `/play` interaction, not config. Field stays optional so
     * existing config.toml files validate; the runtime ignores it.
     */
    server_id: z
      .string()
      .regex(/\d*/, "IDs must only have numeric characters")
      .min(1)
      .optional(),
    /** Root directory under which per-guild session dirs are created. Defaults to "saves". */
    state_root_dir: z.string().min(1).default("saves"),
    bot: z.strictObject({
      enabled: z.boolean(),
      discord_token: z.string().min(1),
      application_id: z
        .string()
        .regex(/\d*/, "IDs must only have numeric characters")
        .min(1),
      commands: z.strictObject({
        enabled: z.boolean(),
        update: z.boolean(),
        screenshot: z.strictObject({
          enabled: z.boolean(),
        }),
      }),
      notifications: z.strictObject({
        /**
         * Legacy notifications channel id. Notifications now target the session's bound
         * text channel (the channel `/play` was invoked in). Optional + ignored.
         */
        channel_id: z
          .string()
          .regex(/\d*/, "IDs must only have numeric characters")
          .min(1)
          .optional(),
        enabled: z.boolean(),
      }),
    }),
    stream: z.strictObject({
      enabled: z.boolean(),
      /**
       * Legacy voice channel id. The voice channel comes from the caller's voice state
       * on `/play`. Optional + ignored.
       */
      channel_id: z
        .string()
        .regex(/\d*/, "IDs must only have numeric characters")
        .min(1)
        .optional(),
      dynamic_streaming: z.boolean(),
      minimum_in_channel: z.number().nonnegative(),
      require_watching: z.boolean(),
      /**
       * The selfbot account that joins voice channels and streams the game. ONE
       * userbot per deployment — the emulator is a single-slot resource (at most
       * one active game at a time per pod), so there's nothing to gain from a
       * pool of N userbots here. The account just needs to be a member of every
       * Discord server you want this deployment to serve.
       */
      userbot: z.strictObject({
        id: z
          .string()
          .regex(/\d*/, "IDs must only have numeric characters")
          .min(1),
        token: z.string().min(1),
      }),
      video: z.strictObject({
        // @deprecated Superseded by the 16:9 letterbox (canvas_height + display
        // aspect). Retained, optional, so existing config.toml files still validate;
        // no longer read. Remove once all configs drop it.
        scale: z.number().int().min(1).max(6).optional(),
        frame_rate: z.number().positive(),
        bitrate_kbps: z.number().positive(),
        bitrate_max_kbps: z.number().positive(),
        // Height of the 16:9 output canvas sent to Discord (width derived as 16:9).
        // The 4:3 game is scaled to fit and pillarboxed onto black.
        canvas_height: z.number().int().positive().default(720),
        // VAAPI hardware H.264 encoding on an Intel iGPU. Off by default (software
        // libx264 fallback); also enableable via the STREAM_HARDWARE_ACCELERATION env.
        hardware_acceleration: z.boolean().default(false),
        vaapi_device: z.string().min(1).default("/dev/dri/renderD128"),
        // VAAPI `-async_depth`: encode-pipeline depth in frames. 1 (our default)
        // trades pipelining for ~one frame-interval less latency; set 2 to A/B
        // against ffmpeg's own default. VAAPI path only.
        encoder_async_depth: z.number().int().min(1).max(64).default(1),
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
      // Discord sign-in for the controller page. Required whenever the page's
      // API is served: seats are only for signed-in players in the game's voice
      // channel. The client secret is a credential and comes from the
      // DISCORD_CLIENT_SECRET env var, not this file.
      auth: z
        .strictObject({
          // The origin players open the page on. The OAuth redirect URI is built
          // from it (TLS ends at Cloudflare, so the request's own URL is http)
          // and must be registered on the bot's Discord application.
          public_origin: z
            .url()
            .refine(
              (value) => new URL(value).origin === value,
              "an origin only: scheme, host and optional port, no trailing slash",
            ),
        })
        .optional(),
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
    driver_feed: z
      .strictObject({
        // Off by default — turning it on starts a second ffmpeg process. Opt in per
        // deployment once the uplink has been measured against `bitrate_kbps`.
        enabled: z.boolean().default(false),
        // Height of the square-pixel image sent to the browser; the anamorphic
        // 640x240 framebuffer is scaled to 4:3 at this height (480 -> 640x480), so
        // the client can paint it without correcting the aspect itself.
        height: z.number().int().min(120).max(1080).default(480),
        bitrate_kbps: z.number().int().positive().default(2500),
        bitrate_max_kbps: z.number().int().positive().default(4000),
        // Keyframe cadence in frames. Every IDR costs a bitrate spike on a TCP
        // socket, but it is also the only resync point for a client the hub had to
        // drop delta units from. 30 frames = ~1 s at the default output rate.
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
      .prefault({}),
  })
  .refine(
    (config) =>
      !(config.web.enabled && config.web.api.enabled) ||
      config.web.auth !== undefined,
    {
      message:
        "[web.auth] is required when the web API is enabled: seats need Discord sign-in",
      path: ["web", "auth"],
    },
  );
