import { z } from "zod";

export type Config = z.infer<typeof ConfigSchema>;
export const ConfigSchema = z.strictObject({
  server_id: z
    .string()
    .regex(/\d*/, "IDs must only have numeric characters")
    .min(1),
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
      channel_id: z
        .string()
        .regex(/\d*/, "IDs must only have numeric characters")
        .min(1),
      enabled: z.boolean(),
    }),
  }),
  stream: z.strictObject({
    enabled: z.boolean(),
    channel_id: z
      .string()
      .regex(/\d*/, "IDs must only have numeric characters")
      .min(1),
    dynamic_streaming: z.boolean(),
    minimum_in_channel: z.number().nonnegative(),
    require_watching: z.boolean(),
    userbot: z.strictObject({
      id: z
        .string()
        .regex(/\d*/, "IDs must only have numeric characters")
        .min(1),
      // Discord user (selfbot) token for the streaming account. Required
      // because Discord blocks video from bot tokens.
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
    }),
  }),
  // Headless N64Wasm (parallel-n64 + angrylion software RDP) host.
  emulator: z.strictObject({
    enabled: z.boolean(),
    // Directory containing the built n64wasm.js/.wasm + staged FS assets
    // (shaders/fonts). Defaults to the bundled assets/n64wasm in the image.
    wasm_dir: z.string().min(1).default("packages/backend/assets/n64wasm"),
    // Path to the Mario Kart 64 ROM (.z64/.v64). Provided at runtime via a
    // volume — never baked into the image. Copyrighted; you supply your own.
    rom_path: z.string().min(1),
    // Emulator step rate. MK64 displays ~30fps; the host has huge headroom.
    fps: z.number().positive().default(30),
    // angrylion software renderer (no GPU). Always true for headless.
    software_render: z.boolean().default(true),
    // Number of web-controller seats to expose (MK64 supports up to 4).
    seats: z.number().int().min(1).max(4).default(4),
  }),
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
});
