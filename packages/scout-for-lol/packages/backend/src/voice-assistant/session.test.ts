import path from "node:path";
import { describe, expect, test } from "vitest";
import { z } from "zod";
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
import { fakeLocalVoiceModels } from "#src/voice-assistant/test-helpers.ts";

function noopSink(): AssistantAudioSink {
  return {
    enqueue: () => {
      /* discarded */
    },
    finish: () => Promise.resolve(),
    cancel: () => Promise.resolve(),
  };
}

const FAKE_MODELS: ScoutVoiceSessionOptions["models"] = fakeLocalVoiceModels();

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

async function expectRateLimitedAfterTwoTurns(
  h: SessionHarness,
  expectedOutcome: "transcript-rejected" | "error",
): Promise<void> {
  await h.session.handleCompletedTurn(pcm(), Date.now());
  await h.session.handleCompletedTurn(pcm(), Date.now());
  expect(h.turnCalls).toBe(1);
  expect(h.observations.map((observation) => observation.outcome)).toEqual([
    expectedOutcome,
    "rate-limited",
  ]);
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

  test("the runtime fragment-tail table matches the committed measurement asset", async () => {
    // Production reads this hard-coded constant; the M2 offline evaluator and packager read
    // ../../assets/voice/fragment-tails.json. Nothing wires them together, so a re-measurement
    // that updates only one of them would let the corpus pass acceptance with timing production
    // never uses. This assertion is the single source-of-truth check for both.
    const assetPath = path.resolve(
      import.meta.dir,
      "../../assets/voice/fragment-tails.json",
    );
    const asset = z
      .object({ tails: z.record(z.string(), z.number()) })
      .parse(await Bun.file(assetPath).json());
    expect(VOICE_FRAGMENT_TAIL_MS).toEqual(asset.tails);
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
    // The stub never handed audio to the sink, so there is no first-reply
    // latency to report — undefined, never a bogus turn duration.
    expect(observations[0]?.wakeToReplySeconds).toBeUndefined();
  });

  test("latency marks the first audio handed to the sink, not turn end", async () => {
    let clock = 10_000;
    const observations: VoiceQuestionObservation[] = [];
    const session = new ScoutVoiceSession({
      guildId: "100000000000000001",
      models: FAKE_MODELS,
      openAiApiKey: "test-key",
      createAssistantAudio: noopSink,
      now: () => clock,
      onQuestionObserved: (observation) => {
        observations.push(observation);
      },
      runTurn: async (_options, input) => {
        // First reply audio arrives 1.5 s after activation; the paced drain
        // then takes far longer and must not count.
        clock = 11_500;
        input.assistantAudio.enqueue(new Uint8Array(2));
        input.assistantAudio.enqueue(new Uint8Array(2));
        clock = 40_000;
        return {
          transcript: "hey scout ping",
          wakeVerified: true,
          mutated: false,
          normalizedCommand: "ping",
        };
      },
    });
    await session.handleCompletedTurn(pcm(), 10_000);
    expect(observations[0]?.wakeToReplySeconds).toBe(1.5);
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
    await expectRateLimitedAfterTwoTurns(h, "transcript-rejected");
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
    await expectRateLimitedAfterTwoTurns(h, "error");
  });
});
