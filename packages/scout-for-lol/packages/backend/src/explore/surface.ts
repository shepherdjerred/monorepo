import { z } from "zod";

/**
 * Which product surface an Explore turn is being answered on.
 *
 * It exists because creating entities from Explore is web-only in v1:
 *
 *  - `/scout ask` is one-shot. It renders a frozen answer and never continues
 *    the conversation, so there is nowhere to put a confirmation card and no
 *    way for the asker to accept one.
 *  - A Discord-upserted user deliberately carries no OAuth token
 *    (`discord/commands/scout.ts` omits the credential fields on purpose), so
 *    their guild permissions cannot be resolved at all.
 *
 * Carried explicitly rather than inferred from `originChannelId`: that field is
 * an optional input no production caller passes, so it is always null and could
 * not distinguish the two surfaces even if it were read that way.
 */
export const ExploreSurfaceSchema = z.enum(["web", "discord"]);
export type ExploreSurface = z.infer<typeof ExploreSurfaceSchema>;
