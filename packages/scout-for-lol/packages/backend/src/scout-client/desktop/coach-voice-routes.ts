import * as Sentry from "@sentry/bun";
import {
  SCOUT_DESKTOP_API_ROUTES,
  SCOUT_DESKTOP_VOICE_TURN_MAX_BYTES,
  ScoutDesktopVoiceTurnRequestSchema,
} from "@scout-for-lol/data";
import { z } from "zod";
import {
  projectGameContext,
  type CoachContextProjection,
} from "#src/coach/context-policy.ts";
import { parseVoiceUtterance } from "#src/coach/voice-turn.ts";
import configuration from "#src/configuration.ts";
import { createLogger } from "#src/logger.ts";
import { resolveVoiceCredential } from "#src/voice-assistant/runtime.ts";
import { isOwnerFlagEnabled, type DesktopExploreCaller } from "./auth.ts";
import {
  VOICE_MESSAGES,
  createVoiceStream,
  emitVoiceError,
  runVoiceTurn,
} from "./coach-voice-turn.ts";
import {
  desktopErrorResponse,
  desktopHeaders,
  writeLimitedResponse,
} from "./contract.ts";
import {
  invalidRequest,
  type DesktopRoute,
  type DesktopRouteHandler,
} from "./explore-run-routes.ts";
import { desktopWriteAllowed } from "./rate-limit.ts";

/**
 * `coach/voice/turns`: a question the player spoke, answered aloud.
 *
 * The desktop records one finished utterance locally — the microphone never
 * streams — and uploads it whole. The server transcribes it itself, so the
 * question is what the player said and no client can put words in their
 * mouth: the route takes no text. That is the proof a `player_voice` turn
 * carries into the coach policy, which treats it as it treats a typed
 * question. `coach-voice-turn.ts` runs the turn.
 *
 * Checked before the stream opens, as typed refusals: the device credential
 * and Explore access (`authenticateDesktopExplore`, in the dispatcher),
 * `scout_desktop_voice` and `scout_desktop_coach`, the device's voice limit,
 * the body, the utterance, the game context, and that this deployment holds a
 * voice credential. Everything after (a wake phrase the server did not hear, a
 * spent allowance, a failed answer) is an `error` event, because the stream is
 * open by then.
 */

const logger = createLogger("coach-voice-routes");
/** The stream says something at least this often, so idle readers wait. */
const KEEPALIVE_MS = 10_000;

/** The request with its context unparsed, so a bad one earns its own code. */
const VoiceTurnEnvelopeSchema = ScoutDesktopVoiceTurnRequestSchema.omit({
  gameContext: true,
}).extend({ gameContext: z.unknown().optional() });

const EMPTY_PROJECTION: CoachContextProjection = {
  context: null,
  present: [],
  accepted: [],
  withheld: [],
};

/** The voice switch and the coach flags, read as `runs/start` reads them. */
async function voiceFlags(caller: DesktopExploreCaller) {
  const [voiceEnabled, coachEnabled, liveAnswersEnabled] = await Promise.all(
    (
      [
        "scout_desktop_voice",
        "scout_desktop_coach",
        "scout_coach_live_answers",
      ] as const
    ).map((name) => isOwnerFlagEnabled(name, caller.userId, caller.guildIds)),
  );
  return {
    voiceEnabled: voiceEnabled === true,
    policy: {
      coachEnabled: coachEnabled === true,
      liveAnswersEnabled: liveAnswersEnabled === true,
    },
  };
}

/** The projected context, a typed refusal, or none when the turn sent none. */
function gateContext(
  gameContext: unknown,
  flags: { coachEnabled: boolean; liveAnswersEnabled: boolean },
): CoachContextProjection | Response {
  if (gameContext === undefined) return EMPTY_PROJECTION;
  const result = projectGameContext(gameContext, {
    initiation: "player_voice",
    flags,
  });
  return result.ok
    ? result.projection
    : desktopErrorResponse(
        "invalid_game_context",
        `The game context does not match the coach contract at ${result.issues.slice(0, 5).join(", ")}.`.slice(
          0,
          500,
        ),
      );
}

function eventStreamResponse(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...desktopHeaders(),
    },
  });
}

const voiceTurn: DesktopRouteHandler = async ({ caller, body, request }) => {
  const flags = await voiceFlags(caller);
  if (!flags.voiceEnabled || !flags.policy.coachEnabled) {
    return desktopErrorResponse(
      "feature_disabled",
      "Voice answers in Scout Desktop are turned off right now.",
    );
  }
  // Counted before the audio is decoded, so a looping client spends its own
  // limit rather than the server's transcription.
  if (!desktopWriteAllowed("voice", caller.device.deviceId)) {
    return writeLimitedResponse();
  }
  const envelope = VoiceTurnEnvelopeSchema.safeParse(body);
  if (!envelope.success) return invalidRequest();
  const { trigger, conversationId, audio, gameContext } = envelope.data;
  const utterance = parseVoiceUtterance(
    new Uint8Array(Buffer.from(audio.base64, "base64")),
  );
  if (!utterance.ok) {
    return desktopErrorResponse("invalid_request", utterance.message);
  }
  const projection = gateContext(gameContext, flags.policy);
  if (projection instanceof Response) return projection;
  const apiKey = await resolveVoiceCredential(configuration.voiceAssistant);
  if (apiKey === undefined) {
    return desktopErrorResponse(
      "unavailable",
      "Voice answers are not set up on this Scout server.",
    );
  }

  const abort = new AbortController();
  const stopListening = (): void => {
    abort.abort(request.signal.reason);
  };
  request.signal.addEventListener("abort", stopListening, { once: true });
  const stream = createVoiceStream(stopListening);
  const keepalive = setInterval(() => {
    stream.keepalive();
  }, KEEPALIVE_MS);
  const started: { runId: string | null } = { runId: null };
  void (async () => {
    try {
      const outcome = await runVoiceTurn(
        {
          caller,
          apiKey,
          utterance: utterance.utterance,
          trigger,
          conversationId,
          flags: flags.policy,
          projection,
          signal: abort.signal,
        },
        stream,
        started,
      );
      if (outcome !== null) stream.emit({ type: "done", outcome });
    } catch (error) {
      // A broken contract inside the turn: loud in the logs and Sentry, and
      // still a typed end for the reader.
      logger.error("Voice turn failed", {
        deviceId: caller.device.deviceId,
        runId: started.runId,
        error: error instanceof Error ? error.message : String(error),
      });
      Sentry.captureException(error, { tags: { source: "coach-voice-turn" } });
      emitVoiceError(stream, "unavailable", VOICE_MESSAGES.unavailable);
      stream.emit({
        type: "done",
        outcome: started.runId === null ? "refused" : "failed",
      });
    } finally {
      clearInterval(keepalive);
      request.signal.removeEventListener("abort", stopListening);
      stream.close();
    }
  })();
  return eventStreamResponse(stream.stream);
};

/** The voice route by path, with the largest body a voice turn may send. */
export const DESKTOP_VOICE_ROUTES: readonly (readonly [
  string,
  DesktopRoute,
])[] = [
  [
    SCOUT_DESKTOP_API_ROUTES.coach_voice_turns.path,
    { handler: voiceTurn, maxBodyBytes: SCOUT_DESKTOP_VOICE_TURN_MAX_BYTES },
  ],
];
