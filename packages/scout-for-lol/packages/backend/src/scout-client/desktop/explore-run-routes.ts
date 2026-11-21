import {
  CoachAppInitiationSchema,
  CoachGameKeySchema,
  ExploreActiveRunSchema,
  ExploreRunObserveRequestSchema,
  ExploreRunOutcomeResultSchema,
  ExploreTurnRequestSchema,
  SCOUT_DESKTOP_API_ROUTES,
  ScoutDesktopEmptyRequestSchema,
  ScoutDesktopRunActiveResponseSchema,
  ScoutDesktopRunStopResponseSchema,
  type ScoutDesktopApiErrorCode,
} from "@scout-for-lol/data";
import { z } from "zod";
import {
  APP_TURN_QUESTIONS,
  appTurnAllowed,
  appTurnLimit,
  appTurnsStarted,
} from "#src/coach/app-turns.ts";
import { prisma } from "#src/database/index.ts";
import type { CoachTurnRecord } from "#src/coach/audit.ts";
import {
  projectGameContext,
  type CoachPolicyFlags,
} from "#src/coach/context-policy.ts";
import { observeExploreRun } from "#src/explore/http/http-route.ts";
import { exploreRunManager } from "#src/explore/runs/run-manager.ts";
import {
  classifyExploreStartError,
  type ExploreStartRefusal,
} from "#src/explore/runs/start-refusal.ts";
import { isOwnerFlagEnabled, type DesktopExploreCaller } from "./auth.ts";
import {
  desktopErrorResponse,
  desktopHeaders,
  desktopJsonResponse,
  writeLimitedResponse,
} from "./contract.ts";
import { desktopWriteAllowed } from "./rate-limit.ts";

/**
 * Explore runs over REST for Scout Desktop: start, stop, list, outcome and
 * the SSE observer.
 *
 * Every route calls what its tRPC procedure or the web's
 * `/api/explore/stream` calls. Starting goes through
 * `exploreRunManager.start` with the owner's identity, so a desktop turn
 * shares the per-user Explore quota and the one-active-run limit with every
 * other surface; this file adds no quota of its own. What it does add is a
 * cap on concurrent stream observers per device, because an observer holds
 * a response open with no idle timeout.
 */

export type DesktopRouteContext = {
  readonly caller: DesktopExploreCaller;
  readonly body: unknown;
  readonly request: Request;
  /** The contract version the client declared, already checked. */
  readonly contractVersion: number;
};
export type DesktopRouteHandler = (
  context: DesktopRouteContext,
) => Promise<Response>;
export type DesktopRoute = {
  readonly handler: DesktopRouteHandler;
  readonly maxBodyBytes: number;
};

export function invalidRequest(): Response {
  return desktopErrorResponse(
    "invalid_request",
    "The request body does not match this route.",
  );
}

function runNotFound(): Response {
  return desktopErrorResponse("not_found", "Run not found.");
}

const START_REFUSAL_CODES = {
  busy: "conversation_busy",
  rate_limited: "quota_exceeded",
  unavailable: "unavailable",
  not_found: "not_found",
  invalid_turn: "invalid_turn",
} as const satisfies Record<
  ExploreStartRefusal["kind"],
  ScoutDesktopApiErrorCode
>;

const MESSAGE_MAX_LENGTH = 500;

export function startRefusalResponse(refusal: ExploreStartRefusal): Response {
  const message =
    refusal.message.length <= MESSAGE_MAX_LENGTH
      ? refusal.message
      : `${refusal.message.slice(0, MESSAGE_MAX_LENGTH - 1)}…`;
  return desktopErrorResponse(
    START_REFUSAL_CODES[refusal.kind],
    message,
    refusal.kind === "rate_limited"
      ? { retryAfterSeconds: refusal.retryAfterSeconds }
      : {},
  );
}

/**
 * `runs/start` as the route reads it: the turn, and the game context still
 * unparsed, so a context that breaks the coach contract earns its own typed
 * refusal rather than `invalid_request`. `ScoutDesktopRunStartRequestSchema`
 * is the same body with the context parsed.
 */
const RunStartEnvelopeSchema = ExploreTurnRequestSchema.safeExtend({
  gameContext: z.unknown().optional(),
});

/**
 * Hold a turn's game context to the coach contract and policy.
 *
 * The proof of player initiation here is minimal: the context rides on a
 * question the player typed, which a regenerate (no new question) never has.
 * Voice turns and follow-up chips each need their own proof before they may
 * carry one.
 */
async function gateGameContext(
  caller: DesktopExploreCaller,
  question: string | null,
  gameContext: unknown,
): Promise<CoachTurnRecord | Response> {
  if (question === null) {
    return desktopErrorResponse(
      "invalid_turn",
      "Only a question you typed can carry your game.",
    );
  }
  const initiation = "player_typed";
  const flags: CoachPolicyFlags = {
    coachEnabled: await isOwnerFlagEnabled(
      "scout_desktop_coach",
      caller.userId,
      caller.guildIds,
    ),
    liveAnswersEnabled: await isOwnerFlagEnabled(
      "scout_coach_live_answers",
      caller.userId,
      caller.guildIds,
    ),
  };
  const result = projectGameContext(gameContext, { initiation, flags });
  if (!result.ok) {
    const where = result.issues.slice(0, 5).join(", ");
    return desktopErrorResponse(
      "invalid_game_context",
      `The game context does not match the coach contract at ${where}.`.slice(
        0,
        MESSAGE_MAX_LENGTH,
      ),
    );
  }
  return {
    deviceId: caller.device.deviceId,
    initiation,
    gameKey: null,
    flags,
    projection: result.projection,
  };
}

const startRun: DesktopRouteHandler = async ({ caller, body }) => {
  const input = RunStartEnvelopeSchema.safeParse(body);
  if (!input.success) return invalidRequest();
  const { gameContext, ...turn } = input.data;
  const coach =
    gameContext === undefined
      ? null
      : await gateGameContext(caller, turn.question, gameContext);
  if (coach instanceof Response) return coach;
  // An edit or a regenerate names where it attaches; a plain question
  // continues the branch on screen. Both start through the same manager and
  // spend the same quota, so this limit only paces how fast one device may
  // fork a conversation.
  if (
    turn.conversationId !== null &&
    turn.attach.kind !== "leaf" &&
    !desktopWriteAllowed("edit", caller.device.deviceId)
  ) {
    return writeLimitedResponse();
  }
  try {
    // A coach turn's audit row is written in the transaction that reserves
    // the run, and its projected context is what the agent reads.
    const run = await exploreRunManager.start(
      { userId: caller.userId },
      turn,
      caller.guildIds,
      coach === null ? { surface: "desktop" } : { surface: "desktop", coach },
    );
    return desktopJsonResponse(ExploreActiveRunSchema.parse(run));
  } catch (error) {
    const refusal = classifyExploreStartError(error);
    if (refusal === null) throw error;
    return startRefusalResponse(refusal);
  }
};

/**
 * `runs/start-app`: a turn Scout starts itself, because a pick or ban changed
 * or the game began. It is the one route that answers without a question the
 * player wrote, so it is held tighter than `runs/start`:
 *
 * - the body names an initiation, never free text; the server words the
 *   question;
 * - the context may carry only the section that initiation exists for, and
 *   never `live`: Riot's policy prohibits unprompted alerts from live state;
 * - at most 4 champ-select turns per champ select and 1 pre-game turn per
 *   game, by the client's `gameKey`, counted from the audit rows;
 * - the turn runs under `scout_desktop_coach` like every coach turn. It is a
 *   public-tier feature and never reads `scout_coach_proactive`.
 */
const AppTurnEnvelopeSchema = z.strictObject({
  conversationId: z.uuid().nullable(),
  initiation: CoachAppInitiationSchema,
  gameKey: CoachGameKeySchema,
  gameContext: z.unknown(),
});

function carriesLive(gameContext: unknown): boolean {
  return (
    typeof gameContext === "object" &&
    gameContext !== null &&
    Object.hasOwn(gameContext, "live")
  );
}

const startAppTurn: DesktopRouteHandler = async ({ caller, body }) => {
  const input = AppTurnEnvelopeSchema.safeParse(body);
  if (!input.success) return invalidRequest();
  const { conversationId, initiation, gameKey, gameContext } = input.data;
  if (carriesLive(gameContext)) {
    return desktopErrorResponse(
      "invalid_game_context",
      "A turn Scout starts never carries live game state.",
    );
  }
  const flags: CoachPolicyFlags = {
    coachEnabled: await isOwnerFlagEnabled(
      "scout_desktop_coach",
      caller.userId,
      caller.guildIds,
    ),
    liveAnswersEnabled: await isOwnerFlagEnabled(
      "scout_coach_live_answers",
      caller.userId,
      caller.guildIds,
    ),
  };
  if (!flags.coachEnabled) {
    return desktopErrorResponse(
      "feature_disabled",
      "Scout Coach is turned off for you.",
    );
  }
  const result = projectGameContext(gameContext, { initiation, flags });
  if (!result.ok) {
    const where = result.issues.slice(0, 5).join(", ");
    return desktopErrorResponse(
      "invalid_game_context",
      `The game context does not match the coach contract at ${where}.`.slice(
        0,
        MESSAGE_MAX_LENGTH,
      ),
    );
  }
  if (result.projection.withheld.length > 0) {
    return desktopErrorResponse(
      "invalid_game_context",
      "This turn carries a section it does not exist for.",
    );
  }
  const started = await appTurnsStarted(prisma, {
    ownerId: caller.userId,
    initiation,
    gameKey,
  });
  if (!appTurnAllowed(initiation, started)) {
    return desktopErrorResponse(
      "rate_limited",
      `Scout has already given its ${appTurnLimit(initiation).toString()} ${
        initiation === "app_pregame" ? "plan" : "champion select suggestions"
      } for this game.`,
    );
  }
  try {
    const run = await exploreRunManager.start(
      { userId: caller.userId },
      ExploreTurnRequestSchema.parse({
        conversationId,
        question: APP_TURN_QUESTIONS[initiation],
        attach: { kind: "leaf" },
      }),
      caller.guildIds,
      {
        surface: "desktop",
        coach: {
          deviceId: caller.device.deviceId,
          initiation,
          gameKey,
          flags,
          projection: result.projection,
        },
      },
    );
    return desktopJsonResponse(ExploreActiveRunSchema.parse(run));
  } catch (error) {
    const refusal = classifyExploreStartError(error);
    if (refusal === null) throw error;
    return startRefusalResponse(refusal);
  }
};

const stopRun: DesktopRouteHandler = async ({ caller, body }) => {
  const input = ExploreRunObserveRequestSchema.safeParse(body);
  if (!input.success) return invalidRequest();
  // Another user's run is indistinguishable from a missing one.
  return (await exploreRunManager.stop(input.data.runId, caller.userId))
    ? desktopJsonResponse(ScoutDesktopRunStopResponseSchema.parse({ ok: true }))
    : runNotFound();
};

const activeRuns: DesktopRouteHandler = async ({ caller, body }) => {
  if (!ScoutDesktopEmptyRequestSchema.safeParse(body).success) {
    return invalidRequest();
  }
  return desktopJsonResponse(
    ScoutDesktopRunActiveResponseSchema.parse({
      runs: await exploreRunManager.listDurable(caller.userId),
    }),
  );
};

const runOutcome: DesktopRouteHandler = async ({ caller, body }) => {
  const input = ExploreRunObserveRequestSchema.safeParse(body);
  if (!input.success) return invalidRequest();
  return desktopJsonResponse(
    ExploreRunOutcomeResultSchema.parse({
      outcome: await exploreRunManager.durableOutcome(
        input.data.runId,
        caller.userId,
      ),
    }),
  );
};

/**
 * Concurrent stream observers one device may hold in this process.
 *
 * An owner has at most one run at a time, so a well-behaved client needs one
 * stream, plus one briefly while a reconnect overlaps the stream it replaces.
 * Three leaves room for a second window without letting a leaked or looping
 * credential pin open responses that skip the idle timeout.
 */
export const DESKTOP_STREAMS_PER_DEVICE = 3;
const streamsByDevice = new Map<string, number>();

/** Hold one observer slot for a device, or null when it holds them all. */
function claimStreamSlot(deviceId: string): (() => void) | null {
  const held = streamsByDevice.get(deviceId) ?? 0;
  if (held >= DESKTOP_STREAMS_PER_DEVICE) return null;
  streamsByDevice.set(deviceId, held + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (streamsByDevice.get(deviceId) ?? 1) - 1;
    if (remaining <= 0) streamsByDevice.delete(deviceId);
    else streamsByDevice.set(deviceId, remaining);
  };
}

/** Streams a device holds open right now, for tests. */
export function desktopStreamsHeldForTests(deviceId: string): number {
  return streamsByDevice.get(deviceId) ?? 0;
}

export function resetDesktopStreamSlotsForTests(): void {
  streamsByDevice.clear();
}

const streamRun: DesktopRouteHandler = async ({ caller, body, request }) => {
  const input = ExploreRunObserveRequestSchema.safeParse(body);
  if (!input.success) return invalidRequest();
  const release = claimStreamSlot(caller.device.deviceId);
  if (release === null) {
    return desktopErrorResponse(
      "stream_limit",
      "This device is already following too many answers. Close one and try again.",
    );
  }
  const response = await observeExploreRun({
    request,
    runId: input.data.runId,
    userId: caller.userId,
    headers: desktopHeaders(),
    onDetach: release,
  });
  return response ?? runNotFound();
};

/** Desktop run routes by path; `turn` takes a question-sized body. */
export const DESKTOP_RUN_ROUTES: readonly {
  readonly path: string;
  readonly handler: DesktopRouteHandler;
  readonly turn: boolean;
}[] = [
  {
    path: SCOUT_DESKTOP_API_ROUTES.explore_runs_start.path,
    handler: startRun,
    turn: true,
  },
  {
    path: SCOUT_DESKTOP_API_ROUTES.explore_runs_start_app.path,
    handler: startAppTurn,
    turn: true,
  },
  {
    path: SCOUT_DESKTOP_API_ROUTES.explore_runs_stop.path,
    handler: stopRun,
    turn: false,
  },
  {
    path: SCOUT_DESKTOP_API_ROUTES.explore_runs_active.path,
    handler: activeRuns,
    turn: false,
  },
  {
    path: SCOUT_DESKTOP_API_ROUTES.explore_runs_outcome.path,
    handler: runOutcome,
    turn: false,
  },
  {
    path: SCOUT_DESKTOP_API_ROUTES.explore_runs_stream.path,
    handler: streamRun,
    turn: false,
  },
];
