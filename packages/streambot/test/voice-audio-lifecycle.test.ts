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
          ? {
              detector: "sherpa",
              phrase: "HEY",
              score: null,
              fragmentEndSeconds: null,
            }
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
        fragmentEndSeconds: null,
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
      verificationDelayMs: 0,
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
      verificationDelayMs: 0,
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
      verificationDelayMs: 0,
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
              ? {
                  detector: "sherpa",
                  phrase: "HEY",
                  score: null,
                  fragmentEndSeconds: null,
                }
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
      verificationDelayMs: 0,
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
      verificationDelayMs: 0,
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

type TickerHarness = {
  nowMs: { value: number };
  tick: () => void;
  created: () => number;
  stopped: () => number;
  createSilenceTicker: (onTick: () => void, intervalMs: number) => () => void;
  now: () => number;
};

function tickerHarness(): TickerHarness {
  const nowMs = { value: 0 };
  let onTick: (() => void) | null = null;
  let created = 0;
  let stopped = 0;
  const stop = (): void => {
    stopped += 1;
  };
  return {
    nowMs,
    tick: () => {
      if (onTick === null) throw new Error("no silence ticker is active");
      onTick();
    },
    created: () => created,
    stopped: () => stopped,
    createSilenceTicker: (callback) => {
      created += 1;
      onTick = callback;
      return stop;
    },
    now: () => nowMs.value,
  };
}

describe("VoiceAudioLifecycle DTX endpointing", () => {
  test("endpoints on wall-clock silence when the client's DTX stops the packet stream", async () => {
    const ticker = tickerHarness();
    const turns: { userId: string; sampleCount: number }[] = [];
    const lifecycle = new VoiceAudioLifecycle({
      // vadEndsOn 0: the fake VAD completes on a silence chunk, like Silero after real silence.
      models: fakeModels(2, 0),
      preRollMs: 1200,
      maxUtteranceMs: 15_000,
      verificationDelayMs: 0,
      postVerificationMs: 0,
      now: ticker.now,
      createSilenceTicker: ticker.createSilenceTicker,
      createDecoder: () => ({
        decode: (opus) => new Float32Array([opus[0] ?? 0]),
        close: () => {
          /* fake has no decoder handle */
        },
      }),
      onTurn: async (turn) => {
        turns.push({ userId: turn.userId, sampleCount: turn.pcm16k.length });
      },
    });

    lifecycle.accept(audio("speaker-a", 2));
    lifecycle.accept(audio("speaker-a", 3));
    await Bun.sleep(0);
    // The speaker stopped talking: no more packets ever arrive. Without silence injection this
    // turn could only end at the 15 s max-utterance timeout.
    expect(turns).toEqual([]);

    ticker.nowMs.value += 200;
    ticker.tick();
    await Promise.resolve();
    expect(turns).toEqual([{ userId: "speaker-a", sampleCount: 1602 }]);
    expect(ticker.stopped()).toBe(1);
    lifecycle.close();
  });

  test("fills the verification window from wall-clock silence so a wake in DTX still verifies", async () => {
    const ticker = tickerHarness();
    let verificationCalls = 0;
    const turns: string[] = [];
    const models = fakeModels(2, 0);
    const lifecycle = new VoiceAudioLifecycle({
      models: {
        ...models,
        verifyWakePhrase: (samples) => {
          verificationCalls += 1;
          return models.verifyWakePhrase(samples);
        },
      },
      preRollMs: 1200,
      maxUtteranceMs: 15_000,
      // 200 ms of post-candidate audio required before the verifier can score.
      verificationDelayMs: 200,
      postVerificationMs: 0,
      now: ticker.now,
      createSilenceTicker: ticker.createSilenceTicker,
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
    lifecycle.accept(audio("speaker-a", 3));
    expect(verificationCalls).toBe(0);

    // DTX silence fills the remaining window; the wake is not lost.
    ticker.nowMs.value += 200;
    ticker.tick();
    ticker.tick();
    await Bun.sleep(0);
    expect(verificationCalls).toBe(1);
    expect(turns).toEqual(["speaker-a"]);
    lifecycle.close();
  });

  test("creates no ticker before a candidate and stops it on rejection and close", async () => {
    const ticker = tickerHarness();
    const models = fakeModels(2, 0);
    const lifecycle = new VoiceAudioLifecycle({
      models: {
        ...models,
        verifyWakePhrase: () => Promise.resolve({ accepted: false, score: 0 }),
      },
      preRollMs: 1200,
      maxUtteranceMs: 15_000,
      verificationDelayMs: 0,
      postVerificationMs: 0,
      now: ticker.now,
      createSilenceTicker: ticker.createSilenceTicker,
      createDecoder: () => ({
        decode: (opus) => new Float32Array([opus[0] ?? 0]),
        close: () => {
          /* fake has no decoder handle */
        },
      }),
      onTurn: () => Promise.reject(new Error("rejected wake reached command")),
    });

    lifecycle.accept(audio("speaker-a", 1));
    expect(ticker.created()).toBe(0);

    lifecycle.accept(audio("speaker-a", 2));
    expect(ticker.created()).toBe(1);
    lifecycle.accept(audio("speaker-a", 3));
    await Bun.sleep(0);
    expect(ticker.stopped()).toBe(1);

    lifecycle.accept(audio("speaker-a", 2));
    expect(ticker.created()).toBe(2);
    lifecycle.close();
    expect(ticker.stopped()).toBe(2);
  });

  test("injects nothing while packets are still arriving within the gap threshold", async () => {
    const ticker = tickerHarness();
    let verificationCalls = 0;
    const models = fakeModels(2, 0);
    const lifecycle = new VoiceAudioLifecycle({
      models: {
        ...models,
        verifyWakePhrase: (samples) => {
          verificationCalls += 1;
          return models.verifyWakePhrase(samples);
        },
      },
      preRollMs: 1200,
      maxUtteranceMs: 15_000,
      verificationDelayMs: 200,
      postVerificationMs: 0,
      now: ticker.now,
      createSilenceTicker: ticker.createSilenceTicker,
      createDecoder: () => ({
        decode: (opus) => new Float32Array([opus[0] ?? 0]),
        close: () => {
          /* fake has no decoder handle */
        },
      }),
      onTurn: () => Promise.reject(new Error("no turn should complete")),
    });

    lifecycle.accept(audio("speaker-a", 2));
    // Jitter, not DTX: the gap is below the threshold, so a tick injects nothing and the
    // verification window stays unfilled.
    ticker.nowMs.value += 50;
    ticker.tick();
    ticker.tick();
    await Bun.sleep(0);
    expect(verificationCalls).toBe(0);
    lifecycle.close();
  });
});

describe("VoiceAudioLifecycle failure containment", () => {
  test("rebuilds a speaker whose decoder throws instead of wedging wake detection", async () => {
    const decodeErrors: unknown[] = [];
    const turns: string[] = [];
    let decodeCalls = 0;
    const lifecycle = new VoiceAudioLifecycle({
      models: fakeModels(2, 4),
      preRollMs: 1200,
      maxUtteranceMs: 15_000,
      verificationDelayMs: 0,
      postVerificationMs: 0,
      createDecoder: () => ({
        decode: (opus) => {
          decodeCalls += 1;
          if (decodeCalls === 1) throw new Error("wedged libav context");
          return new Float32Array([opus[0] ?? 0]);
        },
        close: () => {
          /* fake has no decoder handle */
        },
      }),
      onDecodeError: (error) => decodeErrors.push(error),
      onTurn: async (turn) => {
        turns.push(turn.userId);
      },
    });

    lifecycle.accept(audio("speaker-a", 1));
    expect(decodeErrors).toHaveLength(1);
    expect(turns).toEqual([]);

    // The next packets rebuild the speaker's decoder/detector and a wake still completes.
    lifecycle.accept(audio("speaker-a", 2));
    lifecycle.accept(audio("speaker-a", 3));
    lifecycle.accept(audio("speaker-a", 4));
    await Promise.resolve();
    expect(turns).toEqual(["speaker-a"]);
    lifecycle.close();
  });

  test("a fragment missing from the tail table throws before any turn state is provisioned", async () => {
    const turns: string[] = [];
    let vads = 0;
    let vadCloses = 0;
    const models = fakeModels(2, 4);
    const lifecycle = new VoiceAudioLifecycle({
      models: {
        ...models,
        createKeywordDetector: () => ({
          accept: (samples) =>
            samples[0] === 2
              ? {
                  detector: "sherpa",
                  phrase: "UNDECLARED_FRAGMENT",
                  score: null,
                  // A timestamp forces the per-fragment tail path, which must reject an
                  // undeclared fragment.
                  fragmentEndSeconds: 0.5,
                }
              : samples[0] === 5
                ? {
                    detector: "sherpa",
                    phrase: "HEY",
                    score: null,
                    fragmentEndSeconds: null,
                  }
                : null,
          reset: () => {
            /* fake has no retained keyword state */
          },
          close: () => {
            /* fake has no native handle */
          },
        }),
        createVad: () => {
          vads += 1;
          const vad = models.createVad();
          return {
            ...vad,
            close: () => {
              vadCloses += 1;
              vad.close();
            },
          };
        },
      },
      preRollMs: 1200,
      maxUtteranceMs: 15_000,
      verificationDelayMs: 0,
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

    // The packaging bug fails loudly, before a VAD or a max-utterance timer exists.
    expect(() => {
      lifecycle.accept(audio("speaker-a", 2));
    }).toThrow("No verification tail is defined for fragment");
    expect(vads).toBe(0);
    expect(turns).toEqual([]);

    // The lifecycle is still coherent: a later declared wake completes normally, and no stray
    // timer from the failed provision exists to time it out.
    lifecycle.accept(audio("speaker-a", 5));
    lifecycle.accept(audio("speaker-a", 3));
    lifecycle.accept(audio("speaker-a", 4));
    await Promise.resolve();
    expect(turns).toEqual(["speaker-a"]);
    expect(vads).toBe(1);
    lifecycle.close();
    expect(vadCloses).toBe(1);
  });
});
