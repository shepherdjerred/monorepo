import { describe, expect, test } from "bun:test";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import { register } from "@shepherdjerred/streambot/observability/metrics-registry.ts";
import { VoiceSessionTelemetry } from "@shepherdjerred/streambot/observability/voice-session.ts";
import { VoiceCaptureManager } from "@shepherdjerred/streambot/voice/capture-manager.ts";
import {
  VoiceCaptureManifestSchema,
  type VoiceCaptureManifest,
} from "@shepherdjerred/streambot/voice/capture-manifest.ts";
import {
  createS3CaptureObjectStore,
  VoiceCaptureUploadQueue,
  type CaptureObject,
  type CaptureObjectStore,
  type CaptureUploadJob,
} from "@shepherdjerred/streambot/voice/capture-store.ts";
import { encodePcm16MonoWave } from "@shepherdjerred/streambot/voice/wave-io.ts";

const CAPTURE_CONFIG: Config["voice"]["capture"] = {
  enabled: true,
  bucket: "streambot-voice-captures",
  endpoint: "http://127.0.0.1:9999",
  region: "us-east-1",
  forcePathStyle: true,
};

class RecordingStore implements CaptureObjectStore {
  readonly objects: { key: string; body: Uint8Array; contentType: string }[] =
    [];
  readonly deletedKeys: string[] = [];

  async put(object: CaptureObject): Promise<void> {
    this.objects.push({ ...object, body: Uint8Array.from(object.body) });
  }

  async delete(key: string): Promise<void> {
    this.deletedKeys.push(key);
  }
}

function manifest(captureId = crypto.randomUUID()): VoiceCaptureManifest {
  const now = new Date().toISOString();
  return VoiceCaptureManifestSchema.parse({
    schemaVersion: 1,
    captureId,
    kind: "debug-window",
    committedAt: now,
    startedAt: now,
    endedAt: now,
    guildId: "guild-1",
    channelId: "channel-1",
    terminalOutcome: "test",
    truncated: false,
    audio: [],
    tools: [],
    errors: [],
  });
}

describe("voice capture WAV encoding", () => {
  test("writes playable 16kHz mono PCM16 with bounded samples", async () => {
    const samples = new Float32Array([-2, -0.5, 0, 0.5, 2]);
    const wav = encodePcm16MonoWave(samples, 16_000);
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe("RIFF");
    expect(new DataView(wav.buffer).getUint32(24, true)).toBe(16_000);
    expect(new DataView(wav.buffer).getInt16(44, true)).toBe(-32_768);
    expect(new DataView(wav.buffer).getInt16(52, true)).toBe(32_767);

    expect(wav.byteLength).toBe(44 + samples.length * 2);
  });
});

describe("voice capture upload queue", () => {
  test("uploads audio before the manifest commit marker", async () => {
    const store = new RecordingStore();
    const queue = new VoiceCaptureUploadQueue(store);
    const captureId = crypto.randomUUID();
    const job: CaptureUploadJob = {
      captureId,
      audio: [
        {
          key: "voice-captures/one/speaker.wav",
          body: new Uint8Array([1, 2, 3]),
          contentType: "audio/wav",
        },
      ],
      manifestKey: "voice-captures/one/manifest.json",
      manifest: manifest(captureId),
    };
    expect(queue.enqueue(job)).toBe(true);
    await queue.flush();
    expect(store.objects.map(({ key }) => key)).toEqual([
      "voice-captures/one/speaker.wav",
      "voice-captures/one/manifest.json",
    ]);
  });

  test("drops over-capacity jobs without blocking shutdown", async () => {
    const store = new RecordingStore();
    const queue = new VoiceCaptureUploadQueue(store, {
      maxRetainedBytes: 32,
      workerCount: 2,
    });
    expect(
      queue.enqueue({
        captureId: crypto.randomUUID(),
        audio: [
          {
            key: "too-large.wav",
            body: new Uint8Array(64),
            contentType: "audio/wav",
          },
        ],
        manifestKey: "manifest.json",
        manifest: manifest(),
      }),
    ).toBe(false);
    await queue.shutdown();
    expect(store.objects).toHaveLength(0);
  });

  test("contains storage failures and still flushes", async () => {
    const queue = new VoiceCaptureUploadQueue({
      put: () => Promise.reject(new Error("storage unavailable")),
      delete: () => Promise.resolve(),
    });
    expect(
      queue.enqueue({
        captureId: crypto.randomUUID(),
        audio: [],
        manifestKey: "manifest.json",
        manifest: manifest(),
      }),
    ).toBe(true);
    await expect(queue.flush()).resolves.toBeUndefined();
  });

  test("removes uploaded audio when the manifest commit fails", async () => {
    const uploaded = new Set<string>();
    const deleted: string[] = [];
    const queue = new VoiceCaptureUploadQueue({
      put: (object) => {
        if (object.contentType === "application/json") {
          return Promise.reject(new Error("manifest unavailable"));
        }
        uploaded.add(object.key);
        return Promise.resolve();
      },
      delete: (key) => {
        deleted.push(key);
        uploaded.delete(key);
        return Promise.resolve();
      },
    });
    const audioKey = "voice-captures/orphan/speaker.wav";
    expect(
      queue.enqueue({
        captureId: crypto.randomUUID(),
        audio: [
          {
            key: audioKey,
            body: new Uint8Array([1, 2, 3]),
            contentType: "audio/wav",
          },
        ],
        manifestKey: "voice-captures/orphan/manifest.json",
        manifest: manifest(),
      }),
    ).toBe(true);

    await expect(queue.flush()).resolves.toBeUndefined();
    expect(deleted).toEqual([audioKey, "voice-captures/orphan/manifest.json"]);
    expect(uploaded.size).toBe(0);
  });

  test("uses the SDK's bounded three-attempt retry policy", async () => {
    let requests = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        requests += 1;
        return new Response("", { status: requests < 3 ? 500 : 200 });
      },
    });
    const previousAccessKey = Bun.env["AWS_ACCESS_KEY_ID"];
    const previousSecret = Bun.env["AWS_SECRET_ACCESS_KEY"];
    Bun.env["AWS_ACCESS_KEY_ID"] = "test-access-key";
    Bun.env["AWS_SECRET_ACCESS_KEY"] = "test-secret-key";
    try {
      const store = createS3CaptureObjectStore({
        ...CAPTURE_CONFIG,
        endpoint: `http://127.0.0.1:${String(server.port)}`,
      });
      if (store === null) throw new Error("Expected enabled S3 store");
      await store.put({
        key: "voice-captures/retry/test.wav",
        body: new Uint8Array([1, 2, 3]),
        contentType: "audio/wav",
      });
      store.close?.();
      expect(requests).toBe(3);
    } finally {
      if (previousAccessKey === undefined) {
        delete Bun.env["AWS_ACCESS_KEY_ID"];
      } else {
        Bun.env["AWS_ACCESS_KEY_ID"] = previousAccessKey;
      }
      if (previousSecret === undefined) {
        delete Bun.env["AWS_SECRET_ACCESS_KEY"];
      } else {
        Bun.env["AWS_SECRET_ACCESS_KEY"] = previousSecret;
      }
      await server.stop(true);
    }
  });
});

describe("voice capture manager", () => {
  test("rejects manual windows outside the 10 to 300 second range", async () => {
    const manager = new VoiceCaptureManager(
      CAPTURE_CONFIG,
      new RecordingStore(),
    );
    const session = { guildId: "guild-1", channelId: "channel-1" };

    expect(() => manager.startDebug(session, 9)).toThrow(
      "Voice debug duration must be an integer from 10 to 300 seconds",
    );
    expect(() => manager.startDebug(session, 301)).toThrow(
      "Voice debug duration must be an integer from 10 to 300 seconds",
    );
    expect(() => manager.startDebug(session, 10.5)).toThrow(
      "Voice debug duration must be an integer from 10 to 300 seconds",
    );

    await manager.shutdown();
  });

  test("commits a correlated candidate WAV and manifest", async () => {
    const store = new RecordingStore();
    const manager = new VoiceCaptureManager(CAPTURE_CONFIG, store);
    const attempt = manager.begin({
      guildId: "guild-1",
      channelId: "channel-1",
      userId: "user-1",
      detector: "sherpa",
      phrase: "hey streambot",
      score: 0.8,
      fragmentEndSeconds: 0.4,
      detectedAtMs: Date.now(),
    });
    const samples = new Float32Array(16_000);
    samples[0] = 0.5;
    attempt.localVerification({ accepted: true, score: 0.9, latencyMs: 12 });
    attempt.endpoint({
      reason: "vad",
      sawSpeech: true,
      sampleCount: samples.length,
      dtxSamples: 320,
      pcm16k: samples,
    });
    attempt.transcription({
      transcript: "Hey Streambot, skip",
      normalizedCommand: "skip",
      outcome: "accepted",
    });
    attempt.finish("command");
    await manager.shutdown();

    expect(store.objects).toHaveLength(2);
    const audio = store.objects[0];
    const manifestObject = store.objects[1];
    if (audio === undefined || manifestObject === undefined) {
      throw new Error("Expected capture audio and manifest");
    }
    expect(audio.key).toEndWith("/speaker.wav");
    expect(manifestObject.key).toEndWith("/manifest.json");
    const parsed = VoiceCaptureManifestSchema.parse(
      JSON.parse(new TextDecoder().decode(manifestObject.body)),
    );
    expect(parsed.captureId).toBe(attempt.captureId);
    expect(parsed.audio[0]?.sha256).toBe(
      new Bun.CryptoHasher("sha256").update(audio.body).digest("hex"),
    );
    expect(parsed.normalizedCommand).toBe("skip");
    expect(parsed.endpoint?.dtxSeconds).toBe(0.02);
  });

  test("enforces one session-bound manual window and emits per-speaker WAVs", async () => {
    const store = new RecordingStore();
    const manager = new VoiceCaptureManager(CAPTURE_CONFIG, store);
    const session = { guildId: "guild-1", channelId: "channel-1" };
    const started = manager.startDebug(session, 60);
    expect(started.outcome).toBe("started");
    expect(manager.startDebug(session, 60).outcome).toBe("already-active");
    manager.acceptDecoded(session, "user-1", new Float32Array([0.25, -0.25]));
    manager.acceptDecoded(session, "user-2", new Float32Array([0.5]));
    expect(manager.debugStatus(session)?.speakerCount).toBe(2);
    expect(
      manager.stopDebug({ guildId: "guild-2", channelId: "channel-2" }).outcome,
    ).toBe("different-session");
    expect(manager.stopDebug(session).outcome).toBe("stopped");
    await manager.shutdown();

    expect(
      store.objects.map(({ key }) => key.slice(key.lastIndexOf("/") + 1)),
    ).toEqual(["speaker-001.wav", "speaker-002.wav", "manifest.json"]);
    const committed = store.objects.at(-1);
    if (committed === undefined) throw new Error("Expected committed manifest");
    const parsed = VoiceCaptureManifestSchema.parse(
      JSON.parse(new TextDecoder().decode(committed.body)),
    );
    expect(parsed.speakerMappings).toEqual([
      { filename: "speaker-001.wav", userId: "user-1" },
      { filename: "speaker-002.wav", userId: "user-2" },
    ]);
  });

  test("finalizes a manual window as truncated before a ninth speaker is buffered", async () => {
    const store = new RecordingStore();
    const manager = new VoiceCaptureManager(CAPTURE_CONFIG, store);
    const session = { guildId: "guild-1", channelId: "channel-1" };
    expect(manager.startDebug(session, 60).outcome).toBe("started");
    for (let index = 1; index <= 9; index += 1) {
      manager.acceptDecoded(
        session,
        `user-${String(index)}`,
        new Float32Array([0.1]),
      );
    }
    await manager.shutdown();

    const committed = store.objects.at(-1);
    if (committed === undefined) throw new Error("Expected committed manifest");
    const parsed = VoiceCaptureManifestSchema.parse(
      JSON.parse(new TextDecoder().decode(committed.body)),
    );
    expect(parsed.truncated).toBe(true);
    expect(parsed.truncationReason).toBe("speaker-limit");
    expect(parsed.audio).toHaveLength(8);
  });
});

test("active voice metric series are removable at teardown", async () => {
  const labels = { guildId: "metric-guild", channelId: "metric-channel" };
  const telemetry = new VoiceSessionTelemetry(labels);
  telemetry.close();
  expect(await register.metrics()).not.toContain(
    'guild_id="metric-guild",channel_id="metric-channel"',
  );
});
