import { describe, expect, test } from "bun:test";
import type { ReceivedVoiceAudio } from "@shepherdjerred/discord-video-stream";
import { VoiceAudioLifecycle } from "@shepherdjerred/streambot/voice/audio-lifecycle.ts";
import type { WakeCandidateEvidence } from "@shepherdjerred/streambot/voice/audio-lifecycle.ts";
import type { LocalVoiceModels } from "@shepherdjerred/streambot/voice/local-models.ts";

function audio(userId: string, marker: number): ReceivedVoiceAudio {
  return { userId, ssrc: marker, opus: new Uint8Array([marker]) };
}

function fakeModels(wakeOn: number, vadEndsOn: number): LocalVoiceModels {
  return {
    runtime: "native",
    createKeywordDetector: () => ({
      accept: (samples) =>
        samples[0] === wakeOn
          ? { detector: "sherpa", phrase: "HEY", score: null }
          : null,
      reset: () => {
        /* fake has no retained keyword state */
      },
      close: () => {
        /* fake has no native handle */
      },
    }),
    createVad: () => {
      let completed = false;
      return {
        accept: (samples) => {
          if (samples[0] === vadEndsOn) completed = true;
        },
        isSpeechActive: () => true,
        hasCompletedSpeech: () => completed,
        flush: () => {
          /* fake completes synchronously */
        },
        reset: () => {
          /* fake has no retained VAD state */
        },
        close: () => {
          /* fake has no native handle */
        },
      };
    },
    verifyWakePhrase: () => Promise.resolve({ accepted: true, score: 0.9 }),
    close: () => Promise.resolve(),
  };
}

describe("VoiceAudioLifecycle", () => {
  test("holds a typed candidate for 1.25 seconds, rejects locally, and zeros verifier audio", async () => {
    let nowMs = 42;
    let verificationCalls = 0;
    const verificationAudio: { value: Float32Array | null } = { value: null };
    const candidates: WakeCandidateEvidence[] = [];
    const models = fakeModels(2, 4);
    const lifecycle = new VoiceAudioLifecycle({
      models: {
        ...models,
        verifyWakePhrase: (samples) => {
          verificationCalls += 1;
          verificationAudio.value = samples;
          return Promise.resolve({ accepted: false, score: 0.2 });
        },
      },
      preRollMs: 2000,
      maxUtteranceMs: 15_000,
      now: () => nowMs,
      createDecoder: () => ({
        decode: (opus) => {
          const samples = new Float32Array(8000);
          samples.fill((opus[0] ?? 0) / 10);
          samples[0] = opus[0] ?? 0;
          return samples;
        },
        close: () => {
          /* fake has no decoder handle */
        },
      }),
      onCandidate: (candidate) => {
        candidates.push(candidate);
      },
      onTurn: () => Promise.reject(new Error("rejected wake reached command")),
    });

    lifecycle.accept(audio("speaker-a", 2));
    expect(verificationCalls).toBe(0);
    lifecycle.accept(audio("speaker-b", 4));
    lifecycle.accept(audio("speaker-a", 3));
    lifecycle.accept(audio("speaker-a", 3));
    expect(verificationCalls).toBe(0);
    nowMs = 1292;
    lifecycle.accept(audio("speaker-a", 3));
    expect(verificationCalls).toBe(1);
    await Bun.sleep(0);

    expect(candidates).toEqual([
      {
        detector: "sherpa",
        phrase: "HEY",
        score: null,
        userId: "speaker-a",
        detectedAtMs: 42,
      },
    ]);
    const clearedVerificationAudio = verificationAudio.value;
    if (clearedVerificationAudio === null) {
      throw new Error("Expected verifier audio evidence");
    }
    expect(clearedVerificationAudio.every((sample) => sample === 0)).toBe(true);
    lifecycle.close();
  });

  test("makes no command call before wake and locks the turn to its speaker", async () => {
    const turns: string[] = [];
    const lifecycle = new VoiceAudioLifecycle({
      models: fakeModels(2, 4),
      preRollMs: 1200,
      maxUtteranceMs: 15_000,
      provisionalMs: 0,
      postVerificationMs: 0,
      createDecoder: () => ({
        decode: (opus) => new Float32Array([opus[0] ?? 0]),
        close: () => {
          /* fake has no decoder handle */
        },
      }),
      onTurn: async (turn) => {
        turns.push(turn.userId);
      },
    });
    lifecycle.accept(audio("speaker-a", 1));
    expect(turns).toEqual([]);
    lifecycle.accept(audio("speaker-a", 2));
    lifecycle.accept(audio("speaker-b", 4));
    lifecycle.accept(audio("speaker-a", 3));
    lifecycle.accept(audio("speaker-a", 4));
    await Promise.resolve();
    expect(turns).toEqual(["speaker-a"]);
    lifecycle.close();
  });

  test("allows a back-to-back wake after the prior transaction completes", async () => {
    const turns: string[] = [];
    const lifecycle = new VoiceAudioLifecycle({
      models: fakeModels(2, 4),
      preRollMs: 0,
      maxUtteranceMs: 15_000,
      provisionalMs: 0,
      postVerificationMs: 0,
      createDecoder: () => ({
        decode: (opus) => new Float32Array([opus[0] ?? 0]),
        close: () => {
          /* fake has no decoder handle */
        },
      }),
      onTurn: async (turn) => {
        turns.push(turn.userId);
      },
    });
    lifecycle.accept(audio("speaker-a", 2));
    lifecycle.accept(audio("speaker-a", 4));
    await Promise.resolve();
    await Promise.resolve();
    lifecycle.accept(audio("speaker-b", 2));
    lifecycle.accept(audio("speaker-b", 4));
    await Promise.resolve();
    expect(turns).toEqual(["speaker-a", "speaker-b"]);
    lifecycle.close();
  });

  test("retains wake pre-roll and makes the completed transaction single-flight", async () => {
    const turnBarrier = Promise.withResolvers<true>();
    const delivered: number[][] = [];
    const lifecycle = new VoiceAudioLifecycle({
      models: fakeModels(2, 4),
      preRollMs: 1200,
      maxUtteranceMs: 15_000,
      provisionalMs: 0,
      postVerificationMs: 0,
      createDecoder: () => ({
        decode: (opus) => new Float32Array([opus[0] ?? 0]),
        close: () => {
          /* fake has no decoder handle */
        },
      }),
      onTurn: async (turn) => {
        delivered.push([...turn.pcm16k]);
        await turnBarrier.promise;
      },
    });
    lifecycle.accept(audio("speaker-a", 1));
    lifecycle.accept(audio("speaker-a", 2));
    lifecycle.accept(audio("speaker-a", 4));
    lifecycle.accept(audio("speaker-b", 2));
    lifecycle.accept(audio("speaker-b", 4));
    await Promise.resolve();
    await Promise.resolve();
    expect(delivered).toEqual([[1, 2, 4]]);

    turnBarrier.resolve(true);
    await Bun.sleep(0);
    lifecycle.accept(audio("speaker-b", 2));
    lifecycle.accept(audio("speaker-b", 4));
    await Bun.sleep(0);
    expect(delivered).toHaveLength(2);
    lifecycle.close();
  });

  test("pads bounded input through the full provisional verification interval", async () => {
    let verifierSamples = 0;
    const models = fakeModels(2, 4);
    const lifecycle = new VoiceAudioLifecycle({
      models: {
        ...models,
        verifyWakePhrase: (samples) => {
          verifierSamples = samples.length;
          return Promise.resolve({ accepted: true, score: 0.9 });
        },
      },
      preRollMs: 2000,
      maxUtteranceMs: 15_000,
      postVerificationMs: 0,
      createDecoder: () => ({
        decode: (opus) => new Float32Array([opus[0] ?? 0]),
        close: () => {
          /* fake has no decoder handle */
        },
      }),
      onTurn: () => Promise.resolve(),
    });
    lifecycle.accept(audio("speaker-a", 2));
    lifecycle.finishInput();
    await Bun.sleep(0);
    expect(verifierSamples).toBe(20_001);
    lifecycle.close();
  });
});

describe("VoiceAudioLifecycle endpointing and cleanup", () => {
  test("starts VAD at the candidate boundary while retaining pre-roll for submission", async () => {
    const vadInputs: number[] = [];
    const turns: number[][] = [];
    let speech = false;
    let completed = false;
    const lifecycle = new VoiceAudioLifecycle({
      models: {
        runtime: "native",
        createKeywordDetector: () => ({
          accept: (samples) =>
            samples[0] === 2
              ? { detector: "sherpa", phrase: "HEY", score: null }
              : null,
          reset: () => {
            /* fake has no retained keyword state */
          },
          close: () => {
            /* fake has no native handle */
          },
        }),
        createVad: () => ({
          accept: (samples) => {
            const marker = samples[0] ?? 0;
            vadInputs.push(marker);
            if (marker > 0) speech = true;
            if (marker === 0 && speech) completed = true;
          },
          isSpeechActive: () => speech,
          hasCompletedSpeech: () => completed,
          flush: () => {
            /* fake completes synchronously */
          },
          reset: () => {
            speech = false;
            completed = false;
          },
          close: () => {
            /* fake has no native handle */
          },
        }),
        verifyWakePhrase: () => Promise.resolve({ accepted: true, score: 0.9 }),
        close: () => Promise.resolve(),
      },
      preRollMs: 1200,
      maxUtteranceMs: 15_000,
      provisionalMs: 0,
      postVerificationMs: 0,
      createDecoder: () => ({
        decode: (opus) => new Float32Array([opus[0] ?? 0]),
        close: () => {
          /* fake has no decoder handle */
        },
      }),
      onTurn: (turn) => {
        turns.push([...turn.pcm16k]);
        return Promise.resolve();
      },
    });

    lifecycle.accept(audio("speaker-a", 1));
    lifecycle.accept(audio("speaker-a", 2));
    lifecycle.accept(audio("speaker-a", 3));
    lifecycle.accept(audio("speaker-a", 0));
    await Promise.resolve();
    await Promise.resolve();

    expect(vadInputs).toEqual([2, 3, 0]);
    expect(turns).toEqual([[1, 2, 3, 0]]);
    lifecycle.close();
  });

  test("abandons a wake with no command speech at the utterance timeout", async () => {
    const abandoned: string[] = [];
    const models = fakeModels(2, 4);
    const lifecycle = new VoiceAudioLifecycle({
      models: {
        ...models,
        createVad: () => ({
          accept: () => {
            /* silence remains inactive */
          },
          isSpeechActive: () => false,
          hasCompletedSpeech: () => false,
          flush: () => {
            /* fake flush is synchronous */
          },
          reset: () => {
            /* fake has no retained VAD state */
          },
          close: () => {
            /* fake has no native handle */
          },
        }),
      },
      preRollMs: 0,
      maxUtteranceMs: 1,
      provisionalMs: 0,
      postVerificationMs: 0,
      createDecoder: () => ({
        decode: (opus) => new Float32Array([opus[0] ?? 0]),
        close: () => {
          /* fake has no decoder handle */
        },
      }),
      onAbandoned: (reason) => abandoned.push(reason),
      onTurn: () =>
        Promise.reject(new Error("silent turn must not be delivered")),
    });
    lifecycle.accept(audio("speaker-a", 2));
    await Bun.sleep(5);
    expect(abandoned).toEqual(["timeout"]);
    lifecycle.close();
  });
});
