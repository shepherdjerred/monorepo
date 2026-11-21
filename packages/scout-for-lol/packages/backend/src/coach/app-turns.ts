import {
  COACH_APP_TURN_LIMITS,
  type CoachAppInitiation,
  type DiscordAccountId,
} from "@scout-for-lol/data";
import type { Db } from "#src/database/index.ts";

/**
 * The turns Scout Desktop may start without the player asking: advice when a
 * pick or ban changed, and the plan at the start of a game.
 *
 * Each is a client-requested turn through its own typed route
 * (`runs/start-app`), never free text and never live state. The server bounds
 * them itself, so a client that loops or lies cannot turn them into a stream
 * of unprompted advice: 4 champ-select turns per champ select and 1 pre-game
 * turn per game, counted from the audit rows each turn writes with its run.
 * These are public-tier features; `scout_coach_proactive` (the beta-only
 * popups from live state) is a different thing and not read here.
 */

/**
 * What the transcript shows as the question. The server words it, so an app
 * turn has no free text from the client, and the conversation reads as the
 * turn it was.
 */
export const APP_TURN_QUESTIONS: Readonly<Record<CoachAppInitiation, string>> =
  {
    app_champ_select:
      "Champion select changed. What are my options for my pick or ban?",
    app_pregame: "The game is starting. What is my plan for it?",
  };

/** How many turns of this initiation one game key may have started. */
export function appTurnLimit(initiation: CoachAppInitiation): number {
  return COACH_APP_TURN_LIMITS[initiation];
}

/** The turns this owner's game key has already started, of one initiation. */
export async function appTurnsStarted(
  client: Pick<Db, "scoutCoachTurn">,
  input: {
    readonly ownerId: DiscordAccountId;
    readonly initiation: CoachAppInitiation;
    readonly gameKey: string;
  },
): Promise<number> {
  return await client.scoutCoachTurn.count({
    where: {
      ownerId: input.ownerId,
      initiation: input.initiation,
      gameKey: input.gameKey,
    },
  });
}

/** Whether one more app turn of this initiation may start for this game key. */
export function appTurnAllowed(
  initiation: CoachAppInitiation,
  started: number,
): boolean {
  return started < appTurnLimit(initiation);
}

/**
 * What the transcript shows as the question of the post-game review the server
 * starts itself (`scoutCoachReviewWorkflow`); no client supplies it.
 */
export const REVIEW_TURN_QUESTION =
  "The game is over. Review how it went and what to work on.";
