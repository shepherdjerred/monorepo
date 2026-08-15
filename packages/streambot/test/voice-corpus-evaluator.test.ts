import { describe, expect, test } from "bun:test";
import { DiscordOpusEncoder } from "@shepherdjerred/discord-video-stream";
import { evaluateDiscordOpusPackets } from "@shepherdjerred/streambot/voice/corpus-evaluator.ts";
import type { LocalVoiceModels } from "@shepherdjerred/streambot/voice/local-models.ts";

const PACKET_MS = 20;
const CLIP_PACKETS = 200;
const CANDIDATE_PACKET = 25;
const VAD_COMPLETE_PACKET = 90;

/** Real Discord Opus packets, so evaluation runs through the production decoder. */
function clipPackets(packets: number): Uint8Array[] {
  const encoder = new DiscordOpusEncoder();
  try {
    const samples = 24_000 * ((packets * PACKET_MS) / 1000);
    const pcm = new Uint8Array(samples * 2);
    // A quiet tone keeps the decoder honest without inventing anything the fakes read.
    const view = new DataView(pcm.buffer);
    for (let index = 0; index < samples; index += 1) {
      view.setInt16(
        index * 2,
        Math.round(Math.sin((index / 24_000) * 2 * Math.PI * 220) * 3000),
        true,
      );
    }
    return [...encoder.encode(pcm), ...encoder.finish()].slice(0, packets);
  } finally {
    encoder.close();
  }
}

/**
 * Wake on a fixed packet, complete VAD on a later one, and take a real tick to verify — the
 * asynchronous verifier is exactly what let the packet loop outrun the lifecycle's endpoint.
 */
function pacedModels(verificationDelayMs: number): LocalVoiceModels {
  let keywordAccepts = 0;
  let vadAccepts = 0;
  return {
    runtime: "native",
    createKeywordDetector: () => ({
      accept: () => {
        keywordAccepts += 1;
        return keywordAccepts === CANDIDATE_PACKET
          ? { detector: "sherpa", phrase: "HEY_STREAMBOT", score: null }
          : null;
      },
      reset: () => {
        /* the fake keeps no retained keyword state */
      },
      close: () => {
        /* the fake owns no native handle */
      },
    }),
    createVad: () => ({
      accept: () => {
        vadAccepts += 1;
      },
      isSpeechActive: () => true,
      hasCompletedSpeech: () =>
        vadAccepts >= VAD_COMPLETE_PACKET - CANDIDATE_PACKET,
      flush: () => {
        /* the fake completes synchronously */
      },
      reset: () => {
        /* the fake keeps no retained VAD state */
      },
      close: () => {
        /* the fake owns no native handle */
      },
    }),
    verifyWakePhrase: async () => {
      await Bun.sleep(verificationDelayMs);
      return { accepted: true, score: 0.95 };
    },
    close: () => Promise.resolve(),
  };
}

describe("evaluateDiscordOpusPackets", () => {
  test("reports the lifecycle's endpoint, not the end of the clip", async () => {
    const packets = clipPackets(CLIP_PACKETS);
    const result = await evaluateDiscordOpusPackets(pacedModels(15), packets);

    expect(result.candidate).toBe(true);
    expect(result.activated).toBe(true);
    // The wake completes ~1.25 s of provisional audio plus ~0.3 s of post-verification audio after
    // the candidate. Draining the clip first would instead report its full 4 s length, which is how
    // the corpus gate's 1500 ms endpoint budget became unsatisfiable for every activated fixture.
    expect(result.endpointMs).not.toBeNull();
    const endpointMs = result.endpointMs ?? 0;
    expect(endpointMs).toBeGreaterThan(1700);
    expect(endpointMs).toBeLessThan(2600);
    expect(endpointMs).toBeLessThan(CLIP_PACKETS * PACKET_MS - 1000);
  });

  test("a slower verifier does not move the measured endpoint", async () => {
    const fast = await evaluateDiscordOpusPackets(
      pacedModels(1),
      clipPackets(CLIP_PACKETS),
    );
    const slow = await evaluateDiscordOpusPackets(
      pacedModels(60),
      clipPackets(CLIP_PACKETS),
    );

    expect(fast.activated).toBe(true);
    expect(slow.activated).toBe(true);
    expect(slow.endpointMs).toBe(fast.endpointMs);
  });
});
