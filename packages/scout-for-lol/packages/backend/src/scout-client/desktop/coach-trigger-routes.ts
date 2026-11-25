import {
  ExploreTurnRequestSchema,
  SCOUT_DESKTOP_API_ROUTES,
  ScoutDesktopCoachTriggerRequestSchema,
  ScoutDesktopCoachTriggerResponseSchema,
} from "@scout-for-lol/data";
import { z } from "zod";
import {
  COACH_PROACTIVE_INITIATION,
  projectGameContext,
  type CoachPolicyFlags,
} from "#src/coach/context-policy.ts";
import {
  decideProactiveTurn,
  proactiveRefusedIn,
} from "#src/coach/proactive-policy.ts";
import {
  ProactiveTriggerRefusedError,
  proactiveTriggerQuestion,
  triggerEvidenceIssue,
  triggerWindowKey,
} from "#src/coach/proactive-triggers.ts";
import { resolveEnvironment } from "#src/configuration.ts";
import { exploreRunManager } from "#src/explore/runs/run-manager.ts";
import { classifyExploreStartError } from "#src/explore/runs/start-refusal.ts";
import { isOwnerFlagEnabled } from "./auth.ts";
import { desktopErrorResponse, desktopJsonResponse } from "./contract.ts";
import {
  invalidRequest,
  startRefusalResponse,
  type DesktopRouteHandler,
} from "./explore-run-routes.ts";

/**
 * `coach/triggers`: a proactive coach turn Scout Desktop's beta build asks
 * for when one of its scoreboard detectors fires.
 *
 * Riot's published policy prohibits unprompted alerts from live game state,
 * so this is the most tightly held coach route:
 *
 * - production answers `feature_disabled` before the body is parsed or any
 *   flag is read, whatever Flags says (`coach/proactive-policy.ts`);
 * - elsewhere the turn needs `scout_desktop_coach`, `scout_coach_live_answers`
 *   and `scout_coach_proactive` for the owner;
 * - the body is a trigger kind, its evidence and the live snapshot, never
 *   free text; the evidence must match the snapshot and the server words the
 *   question;
 * - the server spaces admitted triggers 90 seconds apart, admits 10 per game
 *   and each event once, by receipts written with the run;
 * - the snapshot is the `live` section, held to the coach contract and policy
 *   like any other, so the turn runs the in-game profile and writes its
 *   `ScoutCoachTurn` audit row with initiation `app_proactive`.
 */

/** The request with the snapshot still unparsed, for its own typed refusal. */
const TriggerEnvelopeSchema = ScoutDesktopCoachTriggerRequestSchema.extend({
  snapshot: z.unknown(),
});

const MESSAGE_MAX_LENGTH = 500;

export function proactiveDisabled(): Response {
  return desktopErrorResponse(
    "feature_disabled",
    "Scout does not start coaching on its own here.",
  );
}

/** The three flags a proactive turn needs, for the owner. */
export async function proactiveOwnerFlags(
  userId: Parameters<typeof isOwnerFlagEnabled>[1],
  guildIds: Parameters<typeof isOwnerFlagEnabled>[2],
) {
  return {
    coachEnabled: await isOwnerFlagEnabled(
      "scout_desktop_coach",
      userId,
      guildIds,
    ),
    liveAnswersEnabled: await isOwnerFlagEnabled(
      "scout_coach_live_answers",
      userId,
      guildIds,
    ),
    proactiveEnabled: await isOwnerFlagEnabled(
      "scout_coach_proactive",
      userId,
      guildIds,
    ),
  };
}

const startTrigger: DesktopRouteHandler = async ({ caller, body }) => {
  const environment = resolveEnvironment();
  // Before anything else: in production no body, flag or provider answer
  // is ever read for this route.
  if (proactiveRefusedIn(environment)) return proactiveDisabled();
  const input = TriggerEnvelopeSchema.safeParse(body);
  if (!input.success) return invalidRequest();
  const { conversationId, gameKey, trigger, snapshot } = input.data;

  const resolved = await proactiveOwnerFlags(caller.userId, caller.guildIds);
  if (!decideProactiveTurn(environment, resolved).admitted) {
    return proactiveDisabled();
  }
  const flags: CoachPolicyFlags = { ...resolved, proactiveEnabled: true };
  const result = projectGameContext(
    { live: snapshot },
    { initiation: COACH_PROACTIVE_INITIATION, flags },
  );
  if (!result.ok) {
    const where = result.issues.slice(0, 5).join(", ");
    return desktopErrorResponse(
      "invalid_game_context",
      `The snapshot does not match the coach contract at ${where}.`.slice(
        0,
        MESSAGE_MAX_LENGTH,
      ),
    );
  }
  const live = result.projection.context?.live;
  if (live === undefined || result.projection.withheld.length > 0) {
    // The decision above admitted every flag the policy reads, so a withheld
    // live section is a broken internal contract, not a refusal.
    throw new Error("An admitted proactive turn lost its live section.");
  }
  const issue = triggerEvidenceIssue(trigger, live);
  if (issue !== null) {
    return desktopErrorResponse(
      "invalid_game_context",
      `The trigger's evidence does not match its snapshot: ${issue}.`,
    );
  }

  try {
    const run = await exploreRunManager.start(
      { userId: caller.userId },
      ExploreTurnRequestSchema.parse({
        conversationId,
        question: proactiveTriggerQuestion(trigger),
        attach: { kind: "leaf" },
      }),
      caller.guildIds,
      {
        surface: "desktop",
        coach: {
          deviceId: caller.device.deviceId,
          initiation: COACH_PROACTIVE_INITIATION,
          gameKey,
          flags,
          projection: result.projection,
          trigger: { kind: trigger.kind, windowKey: triggerWindowKey(trigger) },
        },
      },
    );
    return desktopJsonResponse(
      ScoutDesktopCoachTriggerResponseSchema.parse({ status: "started", run }),
    );
  } catch (error) {
    if (error instanceof ProactiveTriggerRefusedError) {
      const { refusal } = error;
      switch (refusal.kind) {
        case "duplicate":
          return desktopJsonResponse(
            ScoutDesktopCoachTriggerResponseSchema.parse({
              status: "duplicate",
            }),
          );
        case "game_cap":
          return desktopErrorResponse(
            "rate_limited",
            `Scout has already coached ${refusal.limit.toString()} times this game.`,
          );
        case "spacing":
          return desktopErrorResponse(
            "rate_limited",
            "Scout coached a moment ago. It waits before coaching again.",
            { retryAfterSeconds: refusal.retryAfterSeconds },
          );
      }
    }
    const refusal = classifyExploreStartError(error);
    if (refusal === null) throw error;
    return startRefusalResponse(refusal);
  }
};

/** Proactive coach routes by path; the body is a trigger plus one live snapshot. */
export const DESKTOP_COACH_TRIGGER_ROUTES: readonly {
  readonly path: string;
  readonly handler: DesktopRouteHandler;
}[] = [
  {
    path: SCOUT_DESKTOP_API_ROUTES.coach_triggers.path,
    handler: startTrigger,
  },
];
