import {
  COACH_PROACTIVE_SPEECH_MAX_CHARACTERS,
  SCOUT_DESKTOP_API_ROUTES,
  SCOUT_DESKTOP_VOICE_TURN,
  ScoutDesktopCoachTriggerSpeechRequestSchema,
  ScoutDesktopCoachTriggerSpeechResponseSchema,
} from "@scout-for-lol/data";
import { COACH_PROACTIVE_INITIATION } from "#src/coach/context-policy.ts";
import {
  decideProactiveTurn,
  proactiveRefusedIn,
} from "#src/coach/proactive-policy.ts";
import configuration, { resolveEnvironment } from "#src/configuration.ts";
import { prisma } from "#src/database/index.ts";
import { durableExploreOutcome } from "#src/explore/runs/durable-runs.ts";
import { loadExploreRunResult } from "#src/explore/store.ts";
import { resolveVoiceCredential } from "#src/voice-assistant/runtime.ts";
import { isOwnerFlagEnabled } from "./auth.ts";
import { pcmChunks, speakHeld } from "./coach-speech.ts";
import {
  proactiveDisabled,
  proactiveOwnerFlags,
} from "./coach-trigger-routes.ts";
import {
  desktopErrorResponse,
  desktopJsonResponse,
  writeLimitedResponse,
} from "./contract.ts";
import {
  invalidRequest,
  type DesktopRouteHandler,
} from "./explore-run-routes.ts";
import { desktopWriteAllowed } from "./rate-limit.ts";

/**
 * `coach/triggers/speech`: the spoken form of a finished proactive turn's
 * answer, for a beta build whose player has voice conversation mode on and
 * not muted.
 *
 * Proactive turns exist only in beta, so this route is held as tightly as
 * `coach/triggers`:
 *
 * - production answers `feature_disabled` before the body is parsed or any
 *   flag is read (`coach/proactive-policy.ts`);
 * - elsewhere it needs every flag a trigger needs, and `scout_desktop_voice`;
 * - it counts against the device's voice write limit, like a spoken turn;
 * - the body is a run id and nothing else, so no client can choose what is
 *   said: the run must be a succeeded `app_proactive` turn that this device
 *   started for its own owner, and the server speaks that turn's saved answer;
 * - the owner's audio allowance is held before the speech provider is called
 *   (`coach-speech.ts`), and settled at the speech's real length.
 */

/** The run, if the calling device started it as a proactive turn. */
async function proactiveTurn(runId: string, ownerId: string, deviceId: string) {
  const turn = await prisma.scoutCoachTurn.findUnique({
    where: { runId },
    select: {
      ownerId: true,
      deviceId: true,
      conversationId: true,
      initiation: true,
    },
  });
  return turn !== null &&
    turn.ownerId === ownerId &&
    turn.deviceId === deviceId &&
    turn.initiation === COACH_PROACTIVE_INITIATION
    ? turn
    : null;
}

/** Markdown emphasis and code marks, which a voice would read aloud. */
function speakable(text: string): string {
  return text
    .replaceAll(/[*_`#>]+/g, "")
    .replaceAll(/\s+/g, " ")
    .trim();
}

const speakProactiveAnswer: DesktopRouteHandler = async ({
  caller,
  body,
  request,
}) => {
  const environment = resolveEnvironment();
  // Before anything else: in production no body, flag or provider answer
  // is ever read for this route.
  if (proactiveRefusedIn(environment)) return proactiveDisabled();
  if (!desktopWriteAllowed("voice", caller.device.deviceId)) {
    return writeLimitedResponse();
  }
  const input = ScoutDesktopCoachTriggerSpeechRequestSchema.safeParse(body);
  if (!input.success) return invalidRequest();
  const { runId } = input.data;

  const [flags, voiceEnabled] = await Promise.all([
    proactiveOwnerFlags(caller.userId, caller.guildIds),
    isOwnerFlagEnabled("scout_desktop_voice", caller.userId, caller.guildIds),
  ]);
  if (!voiceEnabled || !decideProactiveTurn(environment, flags).admitted) {
    return proactiveDisabled();
  }

  const turn = await proactiveTurn(
    runId,
    caller.userId,
    caller.device.deviceId,
  );
  if (turn === null) {
    return desktopErrorResponse(
      "not_found",
      "This device started no proactive coaching turn with that id.",
    );
  }
  const outcome = await durableExploreOutcome(prisma, runId, caller.userId);
  if (outcome !== "succeeded") {
    return desktopErrorResponse(
      "invalid_turn",
      "That coaching turn has no finished answer to speak.",
    );
  }
  const result = await loadExploreRunResult(prisma, {
    runId,
    conversationId: turn.conversationId,
    userId: caller.userId,
  });
  if (result === null) {
    throw new Error("A succeeded proactive turn has no saved answer.");
  }
  const text = speakable(result.spokenContent ?? result.answer.content);
  if (
    text.length === 0 ||
    text.length > COACH_PROACTIVE_SPEECH_MAX_CHARACTERS
  ) {
    return desktopErrorResponse(
      "invalid_turn",
      "That coaching answer is too long to speak.",
    );
  }
  const apiKey = await resolveVoiceCredential(configuration.voiceAssistant);
  if (apiKey === undefined) {
    return desktopErrorResponse(
      "unavailable",
      "Voice answers are not set up on this Scout server.",
    );
  }

  const spoken = await speakHeld({
    ownerId: caller.userId,
    apiKey,
    runId,
    text,
    signal: request.signal,
  });
  if (!spoken.ok) {
    return spoken.reason === "budget"
      ? desktopErrorResponse(
          "quota_exceeded",
          "Scout's spending allowance is used up for now, so it cannot speak.",
        )
      : desktopErrorResponse(
          "unavailable",
          "Scout could not speak the answer. It is saved in the conversation.",
        );
  }
  const { encoding, sampleRateHz, maxChunkBytes } =
    SCOUT_DESKTOP_VOICE_TURN.speech;
  return desktopJsonResponse(
    ScoutDesktopCoachTriggerSpeechResponseSchema.parse({
      messageId: result.answer.id,
      spokenText: text,
      encoding,
      sampleRateHz,
      chunks: pcmChunks(spoken.pcm, maxChunkBytes),
    }),
  );
};

/** The proactive speech route by path; its body is one run id. */
export const DESKTOP_COACH_TRIGGER_SPEECH_ROUTES: readonly {
  readonly path: string;
  readonly handler: DesktopRouteHandler;
}[] = [
  {
    path: SCOUT_DESKTOP_API_ROUTES.coach_triggers_speech.path,
    handler: speakProactiveAnswer,
  },
];
