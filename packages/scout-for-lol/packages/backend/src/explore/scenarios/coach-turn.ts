import type {
  CoachGameContext,
  ExploreScenarioGameContext,
} from "@scout-for-lol/data";
import {
  APP_TURN_QUESTIONS,
  REVIEW_TURN_QUESTION,
} from "#src/coach/app-turns.ts";
import {
  PROACTIVE_QUESTION_PREFIX,
  isProactiveTriggerQuestion,
} from "#src/coach/proactive-triggers.ts";
import {
  projectGameContext,
  type CoachContextProjection,
} from "#src/coach/context-policy.ts";
import { z } from "zod";
import type { ScenarioWorld } from "#src/explore/scenarios/world.ts";

/**
 * A scenario turn's game context, sent through the server's real coach gate.
 *
 * Production never hands the agent what a client sent: `projectGameContext`
 * holds it to the contract and to the policy (live state only on a turn the
 * player started, only while the kill switch is on). A scenario that built
 * its own context for the agent would test a world the product cannot
 * produce, so this is the same function with the same flags, and the agent
 * sees only the projection.
 */

/** What the gate reads of the seeded world: the case and its tracked players. */
export type ScenarioGateWorld = Pick<ScenarioWorld, "caseId" | "players">;

export type ScenarioCoachTurn = {
  /** What the agent may see; null when the gate withheld every section. */
  readonly coach: CoachGameContext | null;
  readonly projection: CoachContextProjection;
};

/** The recorded match a post-game turn reviews, taken from a tracked player. */
function postgameMatchId(world: ScenarioGateWorld, alias: string): string {
  const matchId = world.players.find((player) => player.alias === alias)
    ?.account.latestMatchId;
  if (matchId === undefined || matchId === null) {
    throw new Error(
      `Scenario ${world.caseId} takes its post-game match from ${alias}, who has no recorded match.`,
    );
  }
  return matchId;
}

/**
 * The question a turn asks. A Scout-started turn has no free text: the server
 * words it, so the case must quote that wording or it tests a question the
 * product never asks.
 */
export function scenarioCoachQuestion(
  question: string,
  gameContext: ExploreScenarioGameContext,
): string {
  const { initiation } = gameContext;
  if (initiation === "player_typed" || initiation === "player_voice") {
    return question;
  }
  // A proactive turn's question is worded from the trigger's evidence, so
  // the case quotes it; it must still carry the marker the agent keys on.
  if (initiation === "app_proactive") {
    if (!isProactiveTriggerQuestion(question)) {
      throw new Error(
        `An app_proactive turn asks "${PROACTIVE_QUESTION_PREFIX} ...", not "${question}".`,
      );
    }
    return question;
  }
  // App turns are worded for the client routes. The post-game review is
  // worded by the server workflow and is not one of those routes.
  const server =
    initiation === "app_postgame"
      ? REVIEW_TURN_QUESTION
      : APP_TURN_QUESTIONS[initiation];
  if (question !== server) {
    throw new Error(
      `A ${initiation} turn asks "${server}", not "${question}".`,
    );
  }
  return server;
}

export function gateScenarioCoachTurn(
  /** `context` is unchecked here on purpose: the gate is what validates it. */
  gameContext: Omit<ExploreScenarioGameContext, "context"> & {
    readonly context: unknown;
  },
  world: ScenarioGateWorld,
): ScenarioCoachTurn {
  const { postgameOf } = gameContext;
  const raw: unknown =
    postgameOf === undefined
      ? gameContext.context
      : {
          ...z.record(z.string(), z.unknown()).parse(gameContext.context),
          postgame: { matchId: postgameMatchId(world, postgameOf) },
        };
  const result = projectGameContext(raw, {
    initiation: gameContext.initiation,
    flags: {
      coachEnabled: true,
      liveAnswersEnabled: gameContext.liveAnswersEnabled,
    },
  });
  if (!result.ok) {
    throw new Error(
      `Scenario ${world.caseId} carries a context the coach gate refuses: ${result.issues.join(", ")}.`,
    );
  }
  return { coach: result.projection.context, projection: result.projection };
}
