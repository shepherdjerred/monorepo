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
      // Integer upscale of the native 240x160 frame sent to Discord.
      scale: z.number().int().min(1).max(6),
      frame_rate: z.number().positive(),
      bitrate_kbps: z.number().positive(),
      bitrate_max_kbps: z.number().positive(),
    }),
  }),
  game: z.strictObject({
    enabled: z.boolean(),
    // Path to the built pokeemerald.wasm (see scripts/fetch-wasm.ts).
    wasm_path: z.string().min(1),
    // Optional path for the persisted 128 KiB flash save.
    save_path: z.string().min(1).optional(),
    commands: z.strictObject({
      enabled: z.boolean(),
      channel_id: z
        .string()
        .regex(/\d*/, "IDs must only have numeric characters")
        .min(1),
      max_actions_per_command: z.number().nonnegative(),
      max_quantity_per_action: z.number().nonnegative(),
      key_press_duration_in_milliseconds: z.number().nonnegative(),
      delay_between_actions_in_milliseconds: z.number().nonnegative(),
      burst: z.strictObject({
        duration_in_milliseconds: z.number().nonnegative(),
        delay_in_milliseconds: z.number().nonnegative(),
        quantity: z.number().nonnegative(),
      }),
      chord: z.strictObject({
        duration_in_milliseconds: z.number().nonnegative(),
        max_commands: z.number().nonnegative(),
        max_total: z.number().nonnegative(),
        delay: z.number().nonnegative(),
      }),
      hold: z.strictObject({
        duration_in_milliseconds: z.number().nonnegative(),
      }),
    }),
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
