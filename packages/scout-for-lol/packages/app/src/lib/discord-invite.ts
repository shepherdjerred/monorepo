import { z } from "zod";

// Production Scout bot client id (mirrors the marketing site's
// DISCORD_INVITE_URL). Overridable via VITE_DISCORD_CLIENT_ID so local dev
// can point the install CTA at the beta bot.
const FALLBACK_CLIENT_ID = "1182800769188110366";

const EnvSchema = z.object({
  VITE_DISCORD_CLIENT_ID: z.string().min(1).optional(),
});

function clientId(): string {
  const parsed = EnvSchema.safeParse(import.meta.env);
  const fromEnv = parsed.success
    ? parsed.data.VITE_DISCORD_CLIENT_ID
    : undefined;
  return fromEnv ?? FALLBACK_CLIENT_ID;
}

export const DISCORD_INVITE_URL = `https://discord.com/oauth2/authorize?client_id=${clientId()}`;
