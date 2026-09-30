import path from "node:path";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  VOICE_WAKE_WINDOW_MS,
  type AssistantAudioSink,
} from "@shepherdjerred/voice-assistant";
import { ExploreMessageSchema } from "@scout-for-lol/data";
import {
  VOICE_FRAGMENT_TAIL_MS,
  VOICE_PRE_ROLL_MS,
} from "#src/voice-assistant/constants.ts";
import {
  ScoutVoiceSession,
  type ScoutVoiceSessionOptions,
  type VoiceQuestionObservation,
} from "#src/voice-assistant/session.ts";
import { fakeLocalVoiceModels } from "#src/voice-assistant/test-helpers.ts";
import type {
  StartedVoiceExplore,
  VoiceExploreCompletion,
} from "#src/voice-assistant/explore-adapter.ts";

const CONVERSATION_ID = "11111111-1111-4111-8111-111111111111";

function answer(content: string) {
  return ExploreMessageSchema.parse({
    id: globalThis.crypto.randomUUID(),
    role: "assistant",
    content,
    createdAt: new Date().toISOString(),
  });
}

function completed(content: string, spokenContent = content) {
  return Promise.resolve({
    outcome: "succeeded" as const,
    answer: answer(content),
    spokenContent,
  });
}

function turn(userId = "speaker", followUp = false) {
  return {
    userId,
    pcm16k: new Float32Array(160),
    activatedAtMs: 10_000,
    followUp,
  };
}

function stallUntilAborted({
  signal,
}: {
  signal?: AbortSignal;
}): Promise<never> {
  return new Promise((_, reject) => {
    signal?.addEventListener(
      "abort",
      () => {
        reject(new Error("audio request timed out"));
      },
      { once: true },
    );
  });
}

function retryAudioHarness() {
  const retry = new Uint8Array([7, 8]);
  const delivered: number[][] = [];
  const createAssistantAudio = (): AssistantAudioSink => ({
    enqueue: (pcm) => delivered.push([...pcm]),
    finish: () => Promise.resolve(),
    cancel: () => Promise.resolve(),
  });
  return { retry, delivered, createAssistantAudio };
}

type Harness = {
  session: ScoutVoiceSession;
  spoken: string[];
  starts: Parameters<
    NonNullable<ScoutVoiceSessionOptions["startExplore"]>
  >[0][];
  observations: VoiceQuestionObservation[];
};

function harness(
  input: {
    transcripts?: string[];
    completion?: () => Promise<VoiceExploreCompletion>;
    createAssistantAudio?: () => AssistantAudioSink;
    setTimer?: ScoutVoiceSessionOptions["setTimer"];
    overrides?: Partial<
      Pick<
        ScoutVoiceSessionOptions,
        | "feedbackClips"
        | "audioRequestTimeoutMs"
        | "resolveUserProfile"
        | "startExplore"
        | "synthesize"
        | "transcribe"
      >
    >;
  } = {},
): Harness {
  const spoken: string[] = [];
  const starts: Harness["starts"] = [];
  const observations: VoiceQuestionObservation[] = [];
  const transcripts = [...(input.transcripts ?? ["hey scout who wins most"])];
  const sink: AssistantAudioSink = {
    enqueue: (pcm) => {
      expect(pcm).toBeInstanceOf(Uint8Array);
    },
    finish: () => Promise.resolve(),
    cancel: () => Promise.resolve(),
  };
  const session = new ScoutVoiceSession({
    guildId: "100000000000000001",
    models: fakeLocalVoiceModels(),
    openAiApiKey: "test-key",
    createAssistantAudio: input.createAssistantAudio ?? (() => sink),
    resolveUserProfile: () =>
      Promise.resolve({ username: "speaker", avatar: null }),
    transcribe: () => Promise.resolve(transcripts.shift() ?? ""),
    synthesize: ({ text }) => {
      spoken.push(text);
      return Promise.resolve(new Uint8Array([1, 0]));
    },
    startExplore: (request) => {
      starts.push(request);
      return Promise.resolve({
        conversationId: request.conversationId ?? CONVERSATION_ID,
        completion: (input.completion ?? (() => completed("Saved answer")))(),
      });
    },
    onQuestionObserved: (observation) => observations.push(observation),
    ...(input.setTimer === undefined ? {} : { setTimer: input.setTimer }),
    now: () => 11_500,
    ...input.overrides,
  });
  return { session, spoken, starts, observations };
}

describe("voice constants", () => {
  test("the pre-roll covers the shared wake window", () => {
    expect(VOICE_PRE_ROLL_MS).toBe(VOICE_WAKE_WINDOW_MS);
  });

  test("the fragment-tail table matches the committed measurement asset", async () => {
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

describe("ScoutVoiceSession Explore adapter", () => {
  test("sends a verified command to durable Explore and speaks its compact answer", async () => {
    const h = harness({
      completion: () => completed("Full saved answer", "Short spoken answer"),
    });
    await h.session.handleCompletedTurn(turn());

    expect(h.starts).toHaveLength(1);
    expect(h.starts[0]?.question).toBe("who wins most");
    expect(h.spoken).toEqual(["Short spoken answer"]);
    expect(h.observations[0]?.outcome).toBe("answered");
  });

  test("keeps one conversation per speaker and accepts two wake-free follow-ups", async () => {
    const h = harness({
      transcripts: [
        "hey scout first question",
        "first follow up",
        "second follow up",
      ],
    });
    await h.session.handleCompletedTurn(turn("speaker"));
    await h.session.handleCompletedTurn(turn("speaker", true));
    await h.session.handleCompletedTurn(turn("speaker", true));

    expect(h.starts).toHaveLength(3);
    expect(h.starts[0]?.conversationId).toBeNull();
    expect(h.starts[1]?.conversationId).toBe(CONVERSATION_ID);
    expect(h.starts[1]?.question).toBe("first follow up");
    expect(h.starts[2]?.question).toBe("second follow up");
  });

  test("acknowledges after two seconds while the durable answer continues", async () => {
    const deferred =
      Promise.withResolvers<Awaited<ReturnType<typeof completed>>>();
    const h = harness({
      completion: () => deferred.promise,
      setTimer: (callback) => setTimeout(callback, 0),
    });
    await h.session.handleCompletedTurn(turn());
    expect(h.spoken).toEqual(["I'm checking that now."]);

    deferred.resolve(await completed("The final saved answer"));
    await Promise.resolve();
    await Promise.resolve();
    expect(h.spoken).toEqual([
      "I'm checking that now.",
      "The final saved answer",
    ]);
  });

  test("acknowledges while remote Explore setup is still pending", async () => {
    const setup = Promise.withResolvers<StartedVoiceExplore>();
    const h = harness({
      setTimer: (callback) => setTimeout(callback, 0),
      overrides: { startExplore: () => setup.promise },
    });

    await h.session.handleCompletedTurn(turn());
    expect(h.spoken).toEqual(["I'm checking that now."]);

    setup.resolve({
      conversationId: CONVERSATION_ID,
      completion: completed("Answer after remote setup"),
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.spoken).toEqual([
      "I'm checking that now.",
      "Answer after remote setup",
    ]);
  });

  test("records a same-speaker rejection as busy instead of answered", async () => {
    const deferred = Promise.withResolvers<VoiceExploreCompletion>();
    const h = harness({
      transcripts: ["hey scout first", "hey scout second"],
      completion: () => deferred.promise,
      setTimer: (callback) => setTimeout(callback, 0),
    });

    await h.session.handleCompletedTurn(turn());
    await h.session.handleCompletedTurn(turn());

    expect(h.starts).toHaveLength(1);
    expect(h.spoken).toEqual([
      "I'm checking that now.",
      "I'm still working on your last question.",
    ]);
    expect(h.observations[0]?.outcome).toBe("busy");
    deferred.resolve({ outcome: "stopped", answer: null });
  });

  test.each([
    ["failed", "I couldn't finish that question. Please try again.", "error"],
    ["stopped", "That question was stopped.", "interrupted"],
    ["interrupted", "That question was interrupted.", "interrupted"],
  ] as const)(
    "speaks a useful reply when Explore finishes %s before the acknowledgement",
    async (outcome, reply, observed) => {
      const h = harness({
        completion: () => Promise.resolve({ outcome, answer: null }),
      });

      await h.session.handleCompletedTurn(turn());

      expect(h.spoken).toEqual([reply]);
      expect(h.observations[0]?.outcome).toBe(observed);
    },
  );

  test("speaks a terminal failure after a long-running acknowledgement", async () => {
    const deferred = Promise.withResolvers<VoiceExploreCompletion>();
    const h = harness({
      completion: () => deferred.promise,
      setTimer: (callback) => setTimeout(callback, 0),
    });
    await h.session.handleCompletedTurn(turn());

    deferred.resolve({ outcome: "failed", answer: null });
    await Promise.resolve();
    await Promise.resolve();

    expect(h.spoken).toEqual([
      "I'm checking that now.",
      "I couldn't finish that question. Please try again.",
    ]);
  });

  test("serializes replies from different speakers onto one connection", async () => {
    const firstSinkFinished = Promise.withResolvers<boolean>();
    const firstSinkCreated = Promise.withResolvers<boolean>();
    let created = 0;
    let active = 0;
    let maxActive = 0;
    const h = harness({
      transcripts: ["hey scout first", "hey scout second"],
      createAssistantAudio: () => {
        created += 1;
        const position = created;
        if (position === 1) firstSinkCreated.resolve(true);
        active += 1;
        maxActive = Math.max(maxActive, active);
        return {
          enqueue: () => {
            // Packet contents are irrelevant to the connection reservation.
          },
          finish: async () => {
            if (position === 1) await firstSinkFinished.promise;
            active -= 1;
          },
          cancel: () => Promise.resolve(),
        };
      },
    });

    const first = h.session.handleCompletedTurn(turn("first-speaker"));
    await firstSinkCreated.promise;
    expect(created).toBe(1);

    const second = h.session.handleCompletedTurn(turn("second-speaker"));
    await Promise.resolve();
    await Promise.resolve();
    expect(created).toBe(1);

    firstSinkFinished.resolve(true);
    await Promise.all([first, second]);
    expect(created).toBe(2);
    expect(maxActive).toBe(1);
  });

  test("rejects a transcript without the wake phrase outside follow-up mode", async () => {
    const h = harness({ transcripts: ["completely unrelated speech"] });
    await h.session.handleCompletedTurn(turn());

    expect(h.starts).toHaveLength(0);
    expect(h.observations[0]?.outcome).toBe("transcript-rejected");
  });
});

describe("ScoutVoiceSession failure handling", () => {
  test.each(["transcription", "profile", "explore", "synthesis"] as const)(
    "plays local retry feedback when %s fails before completion",
    async (stage) => {
      const { retry, delivered, createAssistantAudio } = retryAudioHarness();
      const failed = (): Promise<never> =>
        Promise.reject(new Error(`${stage} failed`));
      let h: Harness;
      switch (stage) {
        case "transcription":
          h = harness({
            createAssistantAudio,
            overrides: {
              feedbackClips: { retry, prompt: new Uint8Array() },
              transcribe: failed,
            },
          });
          break;
        case "profile":
          h = harness({
            createAssistantAudio,
            overrides: {
              feedbackClips: { retry, prompt: new Uint8Array() },
              resolveUserProfile: failed,
            },
          });
          break;
        case "explore":
          h = harness({
            createAssistantAudio,
            overrides: {
              feedbackClips: { retry, prompt: new Uint8Array() },
              startExplore: failed,
            },
          });
          break;
        case "synthesis":
          h = harness({
            createAssistantAudio,
            overrides: {
              feedbackClips: { retry, prompt: new Uint8Array() },
              synthesize: failed,
            },
          });
      }

      await h.session.handleCompletedTurn(turn());

      expect(delivered).toEqual([[7, 8]]);
      expect(h.observations[0]?.outcome).toBe("error");
    },
  );

  test.each(["transcription", "synthesis"] as const)(
    "times out a stalled %s request and releases the speaker",
    async (stage) => {
      const { retry, delivered, createAssistantAudio } = retryAudioHarness();
      const h = harness({
        transcripts: ["hey scout first", "hey scout second"],
        createAssistantAudio,
        overrides: {
          audioRequestTimeoutMs: 1,
          feedbackClips: { retry, prompt: new Uint8Array() },
          ...(stage === "transcription"
            ? { transcribe: stallUntilAborted }
            : {
                synthesize: stallUntilAborted,
              }),
        },
      });

      await h.session.handleCompletedTurn(turn());

      expect(delivered).toEqual([[7, 8]]);
      expect(h.observations[0]?.outcome).toBe("error");
      if (stage === "synthesis") {
        await h.session.handleCompletedTurn(turn());
        expect(h.starts).toHaveLength(2);
        expect(h.spoken).not.toContain(
          "I'm still working on your last question.",
        );
      }
    },
  );

  test("closing stops delivery but does not cancel the durable completion", async () => {
    const deferred =
      Promise.withResolvers<Awaited<ReturnType<typeof completed>>>();
    const h = harness({
      completion: () => deferred.promise,
      setTimer: (callback) => setTimeout(callback, 0),
    });
    await h.session.handleCompletedTurn(turn());
    h.session.close();
    deferred.resolve(await completed("Saved after disconnect"));
    await Promise.resolve();
    await Promise.resolve();

    expect(h.starts).toHaveLength(1);
    expect(h.spoken).toEqual(["I'm checking that now."]);
  });
});
