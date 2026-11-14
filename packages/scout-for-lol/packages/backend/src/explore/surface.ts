import { z } from "zod";

/**
 * Which product surface an Explore turn is being answered on.
 *
 * Every surface has the same capabilities: the same tools, skills, cards and
 * creations. The surface decides only delivery — a voice turn also writes a
 * spoken summary, Discord renders cards as embeds and follow-ups as buttons —
 * and how the asker's guild permissions are learned. A web session has an
 * OAuth guild list; a `/scout ask` or voice user has no OAuth token, so Scout's
 * bot answers for them (`resolveGuildPermissionsForMember`).
 *
 * `desktop` is Scout Desktop acting as its owner through an `explore`-scoped
 * device credential (`scout-client/desktop/`). It delivers like the web, since
 * the app renders the same transcript, and learns permissions the same way:
 * from the owner's stored Discord OAuth grant, the one a web session uses.
 *
 * Carried explicitly rather than inferred from `originChannelId`: that field is
 * an optional input no production caller passes, so it is always null and could
 * not distinguish the surfaces even if it were read that way.
 */
export const ExploreSurfaceSchema = z.enum([
  "web",
  "discord",
  "voice",
  "desktop",
]);
export type ExploreSurface = z.infer<typeof ExploreSurfaceSchema>;
