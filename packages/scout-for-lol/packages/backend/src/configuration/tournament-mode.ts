import { z } from "zod";

/**
 * Which tournament API the client talks to.
 *
 * `stub` is `tournament-stub-v5`, which any development or standard League key
 * can call. It returns well-formed but non-functional data: the codes it mints
 * do not create a real in-client lobby, its lobby events are canned, and it has
 * no `games/by-code` endpoint at all. It exercises our code paths and nothing
 * about a real game.
 *
 * `live` is `tournament-v5`, which needs a production key with tournament
 * access granted.
 *
 * This is deployment vocabulary, not League vocabulary: an operator picks it
 * and it is read straight out of the environment. Declaring it beside the
 * client that consumes it made the configuration layer import the League
 * domain in order to describe one of its own settings.
 */
export const TournamentApiModeSchema = z.enum(["stub", "live"]);
export type TournamentApiMode = z.infer<typeof TournamentApiModeSchema>;
