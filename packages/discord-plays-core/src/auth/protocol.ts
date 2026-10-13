// The sign-in contract between a game's backend and its page. Browser-safe:
// zod only, imported by both frontends.
import { z } from "zod";

/** A Discord snowflake, as a decimal string. */
export const DiscordIdSchema = z.string().regex(/^\d{1,20}$/u);

/**
 * A signed-in Discord user, as the page shows them.
 *
 * `name` is the game's display name for the player: each game decides how to
 * derive it (Mario Kart folds it to what its stream overlay font can draw).
 */
export type DiscordUser = z.infer<typeof DiscordUserSchema>;
export const DiscordUserSchema = z.strictObject({
  discordId: DiscordIdSchema,
  username: z.string().min(1),
  name: z.string().min(1),
  /** CDN URL of the avatar, or null for Discord's default avatar. */
  avatarUrl: z.url().nullable(),
});

/** `GET /api/me`: who this browser is signed in as, if anyone. */
export type Me = z.infer<typeof MeSchema>;
export const MeSchema = z.discriminatedUnion("signedIn", [
  z.strictObject({ signedIn: z.literal(false) }),
  z.strictObject({ signedIn: z.literal(true), user: DiscordUserSchema }),
]);

/** Paths of the sign-in routes the backend serves next to the page. */
export const AUTH_START_PATH = "/api/auth/discord/start";
export const AUTH_CALLBACK_PATH = "/api/auth/discord/callback";
export const AUTH_LOGOUT_PATH = "/api/auth/logout";
export const ME_PATH = "/api/me";
