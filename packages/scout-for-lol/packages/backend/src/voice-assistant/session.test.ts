import { describe, expect, test } from "vitest";
import {
  NOOP_VOICE_ATTEMPT_OBSERVER,
  VOICE_WAKE_WINDOW_MS,
  VoiceMutationGate,
  type AssistantAudioSink,
} from "@shepherdjerred/voice-assistant";
import {
  VOICE_FRAGMENT_TAIL_MS,
  VOICE_PRE_ROLL_MS,
} from "#src/voice-assistant/constants.ts";
import {
  ScoutVoiceSession,
  type ScoutVoiceSessionOptions,
} from "#src/voice-assistant/session.ts";
import type { VoiceQuestionObservation } from "#src/voice-assistant/session.ts";

function noopSink(): AssistantAudioSink {
  return {
    enqueue: () => {
      /* discarded */
    },
    finish: () => Promise.resolve(),
    cancel: () => Promise.resolve(),
  };
}

const FAKE_MODELS: ScoutVoiceSessionOptions["models"] = {
  runtime: "native",
  createKeywordDetector: () => ({
    accept: () => null,
    reset: () => {
      /* fake */
    },
    close: () => {
      /* fake */
    },
  }),
  createVad: () => ({
    accept: () => {
      /* fake */
    },
    isSpeechActive: () => false,
    hasCompletedSpeech: () => false,
    flush: () => {
      /* fake */
    },
    reset: () => {
      /* fake */
    },
    close: () => {
      /* fake */
    },
  }),
  verifyWakePhrase: () => Promise.resolve({ accepted: false, score: 0 }),
  close: () => Promise.resolve(),
};

type SessionHarness = {
  session: ScoutVoiceSession;
  observations: VoiceQuestionObservation[];
  turnCalls: number;
};

function harness(runTurn: ScoutVoiceSessionOptions["runTurn"]): SessionHarness {
  const observations: VoiceQuestionObservation[] = [];
  const state = { turnCalls: 0 };
  const session = new ScoutVoiceSession({
    guildId: "100000000000000001",
    models: FAKE_MODELS,
    openAiApiKey: "test-key",
    createAssistantAudio: noopSink,
    onQuestionObserved: (observation) => {
      observations.push(observation);
    },
    runTurn: async (options, input) => {
      state.turnCalls += 1;
      if (runTurn === undefined) {
        throw new Error("test harness requires a runTurn stub");
      }
      return await runTurn(options, input);
    },
  });
  return {
    session,
    observations,
    get turnCalls() {
      return state.turnCalls;
    },
  };
}

function pcm(): Float32Array {
  return new Float32Array(160);
}

describe("voice constants", () => {
  test("the pre-roll covers the shared wake window", () => {
    expect(VOICE_PRE_ROLL_MS).toBe(VOICE_WAKE_WINDOW_MS);
  });

  test("the fragment-tail table names the hey-scout keyword fragments", () => {
    expect(VOICE_FRAGMENT_TAIL_MS).toEqual({
      HEY_SCOUT: 0,
      SCOUT: 0,
      HEY: 500,
    });
  });
});

describe("ScoutVoiceSession turns", () => {
  test("maps a verified command to an answered observation with facts", async () => {
    const { session, observations } = harness((options) => {
      // The tools factory is Scout's whole per-turn surface: all four League
      // tools, built against the shared (trivially satisfied) mutation gate.
      const tools = options.tools({
        mutationGate: new VoiceMutationGate(),
        signal: new AbortController().signal,
        attempt: NOOP_VOICE_ATTEMPT_OBSERVER.begin(),
      });
      expect(tools.length).toBe(4);
      return Promise.resolve({
        transcript: "hey scout what does cho'gath ult do",
        wakeVerified: true,
        mutated: false,
        normalizedCommand: "what does cho gath ult do",
      });
    });
    await session.handleCompletedTurn(pcm(), Date.now());
    expect(observations).toHaveLength(1);
    expect(observations[0]?.outcome).toBe("answered");
    expect(observations[0]?.wakeToReplySeconds).toBeGreaterThanOrEqual(0);
  });

  test("burst-exhausted wakes never open a turn", async () => {
    const h = harness(() =>
      Promise.resolve({
        transcript: "hey scout ping",
        wakeVerified: true,
        mutated: false,
        normalizedCommand: "ping",
      }),
    );
    await h.session.handleCompletedTurn(pcm(), Date.now());
    await h.session.handleCompletedTurn(pcm(), Date.now());
    await h.session.handleCompletedTurn(pcm(), Date.now());
    expect(h.turnCalls).toBe(2);
    expect(h.observations.map((observation) => observation.outcome)).toEqual([
      "answered",
      "answered",
      "rate-limited",
    ]);
  });

  test("a rejected transcript starts the cooldown", async () => {
    const h = harness(() =>
      Promise.resolve({
        transcript: "hey scott completely different words",
        wakeVerified: false,
        mutated: false,
        normalizedCommand: null,
      }),
    );
    await h.session.handleCompletedTurn(pcm(), Date.now());
    await h.session.handleCompletedTurn(pcm(), Date.now());
    expect(h.turnCalls).toBe(1);
    expect(h.observations.map((observation) => observation.outcome)).toEqual([
      "transcript-rejected",
      "rate-limited",
    ]);
  });

  test("closing the session interrupts the in-flight turn", async () => {
    const h = harness(
      (_options, input) =>
        new Promise((_resolve, reject) => {
          input.signal?.addEventListener("abort", () => {
            reject(new Error("aborted by session close"));
          });
        }),
    );
    const turn = h.session.handleCompletedTurn(pcm(), Date.now());
    h.session.close();
    await turn;
    expect(h.observations.map((observation) => observation.outcome)).toEqual([
      "interrupted",
    ]);
  });

  test("a quota refusal parks the limiter without throwing", async () => {
    const h = harness(() =>
      Promise.reject(new Error("You exceeded your current quota")),
    );
    await h.session.handleCompletedTurn(pcm(), Date.now());
    await h.session.handleCompletedTurn(pcm(), Date.now());
    expect(h.turnCalls).toBe(1);
    expect(h.observations.map((observation) => observation.outcome)).toEqual([
      "error",
      "rate-limited",
    ]);
  });
});
