import { describe, expect, test } from "bun:test";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import {
  PlaybackCommandService,
  type PlaybackCommandServiceDeps,
} from "@shepherdjerred/streambot/commands/playback-command-service.ts";
import type { ReceivedVoiceAudio } from "@shepherdjerred/discord-video-stream";
import type { PlaybackEvent } from "@shepherdjerred/streambot/machine/types.ts";
import type { StreamerLike } from "@shepherdjerred/streambot/streamer/streamer-types.ts";
import { UserIdSchema } from "@shepherdjerred/streambot/types/ids.ts";
import {
  buildRealtimeSessionConfig,
  runRealtimeCommandTurn,
  runRealtimeVoiceTurn,
  verifyWakeTranscript,
} from "@shepherdjerred/streambot/voice/realtime-agent.ts";
import type { AssistantAudioSink } from "@shepherdjerred/streambot/voice/assistant-sink.ts";
import { VoiceAssistantSession } from "@shepherdjerred/streambot/voice/voice-assistant-session.ts";
import type { LocalVoiceModels } from "@shepherdjerred/streambot/voice/local-models.ts";
import { DryRunVoiceCommandPort } from "@shepherdjerred/streambot/voice/local-voice-probe.ts";
import type { SpokenFeedbackClips } from "@shepherdjerred/streambot/voice/spoken-feedback.ts";
import {
  FakeRealtimeTransport,
  type FakeRealtimeToolCall,
} from "./support/fake-realtime-transport.ts";

const USER = UserIdSchema.parse("100000000000000001");

class DiscardAudio implements AssistantAudioSink {
  readonly chunks: Uint8Array[] = [];
  finishCount = 0;
  cancelCount = 0;

  enqueue(pcm24k: Uint8Array): void {
    this.chunks.push(pcm24k);
  }

  finish(): Promise<void> {
    this.finishCount += 1;
    return Promise.resolve();
  }

  cancel(): Promise<void> {
    this.cancelCount += 1;
    return Promise.resolve();
  }
}

/** A sink whose paced drain never completes on its own — only cancellation ends it. */
class StallingAudio implements AssistantAudioSink {
  finishCount = 0;
  cancelCount = 0;
  private release: (() => void) | null = null;

  constructor(private readonly onDrainStarted: () => void) {}

  enqueue(): void {
    /* the stalled drain never consumes anything */
  }

  finish(): Promise<void> {
    this.finishCount += 1;
    return new Promise<void>((resolve) => {
      this.release = resolve;
      this.onDrainStarted();
    });
  }

  cancel(): Promise<void> {
    this.cancelCount += 1;
    this.release?.();
    this.release = null;
    return Promise.resolve();
  }
}

function releaseTeardownHold(): void {
  /* No session teardown in this unit test. */
}

function holdTeardownForTest(): () => void {
  return releaseTeardownHold;
}

function markerModels(): LocalVoiceModels {
  return {
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
        /* Stateless marker detector. */
      },
      close: () => {
        /* No native handle. */
      },
    }),
    createVad: () => {
      let completed = false;
      return {
        accept: (samples) => {
          if (samples[0] === 4) completed = true;
        },
        isSpeechActive: () => true,
        hasCompletedSpeech: () => completed,
        flush: () => {
          /* Synchronous marker VAD. */
        },
        reset: () => {
          /* Stateless marker VAD. */
        },
        close: () => {
          /* No native handle. */
        },
      };
    },
    verifyWakePhrase: () => Promise.resolve({ accepted: true, score: 0.9 }),
    close: () => Promise.resolve(),
  };
}

function markerDecoder() {
  return {
    decode: (opus: Uint8Array) => {
      const samples = new Float32Array(8000);
      samples[0] = opus[0] ?? 0;
      return samples;
    },
    close: () => {
      /* No native handle. */
    },
  };
}

function emitMarkerTurn(listener: (audio: ReceivedVoiceAudio) => void): void {
  listener({ userId: String(USER), ssrc: 1, opus: new Uint8Array([2]) });
  listener({ userId: String(USER), ssrc: 1, opus: new Uint8Array([4]) });
  listener({ userId: String(USER), ssrc: 1, opus: new Uint8Array([4]) });
  listener({ userId: String(USER), ssrc: 1, opus: new Uint8Array([4]) });
  listener({ userId: String(USER), ssrc: 1, opus: new Uint8Array([4]) });
}

// The paced reply drain now runs inside the transaction budget, so a fixture budget has to be
// long enough for a real `PacedAssistantSender` to finish a short reply. Expiry-driven tests opt
// into a deliberately tiny one.
const EXPIRING_TRANSACTION_TIMEOUT_MS = 50;

function fixture(transactionTimeoutMs = 1000) {
  const events: PlaybackEvent[] = [];
  const speaking: boolean[] = [];
  const replyPackets: Uint8Array[] = [];
  let voiceListener: ((audio: ReceivedVoiceAudio) => void) | null = null;
  const config = loadConfig({
    BOT_TOKEN: "bot",
    USER_TOKENS: "userbot",
    ADMIN_IDS: String(USER),
    VIDEOS_DIR: "/videos",
    VOICE_ASSISTANT_ENABLED: "true",
    OPENAI_API_KEY: "test-key",
    VOICE_TRANSACTION_TIMEOUT_MS: String(transactionTimeoutMs),
  });
  const commandDeps: PlaybackCommandServiceDeps = {
    config,
    dispatch: (event) => events.push(event),
    view: () => ({
      state: "streaming",
      current: {
        title: "Current",
        requesterId: USER,
        chapters: [],
        kind: "file",
        sourceId: "file:/current.mkv",
        durationSeconds: 600,
      },
      queue: [],
      loop: "off",
      volume: 100,
      positionSeconds: 90,
    }),
    library: () => [
      {
        title: "Local Movie",
        path: "/videos/local.mkv",
        relativePath: "local.mkv",
        library: "movies",
      },
    ],
    setVolume: () => Promise.resolve(true),
    seek: () => Promise.resolve(true),
    resolvePlaySource: () =>
      Promise.resolve({
        title: "YouTube",
        ffmpegInput: "https://media.invalid/video",
        chapters: [],
      }),
    announce: () => Promise.resolve(),
  };
  const service = new PlaybackCommandService(commandDeps);
  const streamer: StreamerLike = {
    login: () => Promise.resolve(),
    userId: () => "200000000000000001",
    guildIds: () => [],
    destroy: () => Promise.resolve(),
    joinVoice: (input) => Promise.resolve(input),
    runStream: () => Promise.resolve(),
    leaveVoice: () => Promise.resolve(),
    setVolume: () => Promise.resolve(true),
    setAssistantSpeaking: (value) => {
      speaking.push(value);
      return Promise.resolve();
    },
    sendAssistantOpus: (packet) => replyPackets.push(packet),
    assistantUserId: () => "200000000000000001",
    assistantDaveReady: () => true,
    setVoiceAudioListener: (listener) => {
      voiceListener = listener;
    },
    seek: () => Promise.resolve(true),
    getPosition: () => 90,
    lastVoiceCloseInfo: () => null,
    captureVoiceCloseSource: () => ({
      lastVoiceCloseInfo: () => null,
      release: () => null,
    }),
    setVoiceCloseListener: () => {
      /* No Discord close in this test. */
    },
    setStallListener: () => {
      /* No media pipeline in this test. */
    },
  };
  return {
    config,
    service,
    streamer,
    commandDeps,
    events,
    speaking,
    replyPackets,
    voiceListener: () => voiceListener,
  };
}

async function run(
  call: FakeRealtimeToolCall,
  behavior:
    | "success"
    | "error"
    | "transcription-error"
    | "transcription-error-during-connect"
    | "response-error"
    | "disconnect"
    | "timeout" = "success",
) {
  const context = fixture(
    behavior === "timeout" ? EXPIRING_TRANSACTION_TIMEOUT_MS : undefined,
  );
  const transport = new FakeRealtimeTransport([call], behavior);
  const promise = runRealtimeVoiceTurn(context.config.voice, {
    pcm16k: new Float32Array(1600),
    activatedAtMs: Date.now(),
    userId: USER,
    service: context.service,
    streamer: context.streamer,
    createTransport: () => transport,
  });
  return { ...context, transport, promise };
}

async function runLocal(
  calls: readonly FakeRealtimeToolCall[],
  inputTranscript: string,
  feedbackClips?: SpokenFeedbackClips,
) {
  const context = fixture();
  const transport = new FakeRealtimeTransport(
    calls,
    "success",
    inputTranscript,
  );
  const commands = new DryRunVoiceCommandPort();
  const assistantAudio = new DiscardAudio();
  const result = await runRealtimeCommandTurn(context.config.voice, {
    pcm16k: new Float32Array(1600),
    activatedAtMs: Date.now(),
    commands,
    assistantAudio,
    ...(feedbackClips === undefined ? {} : { feedbackClips }),
    createTransport: () => transport,
  });
  return { ...context, transport, commands, assistantAudio, result };
}

describe("custom Realtime transport", () => {
  test("accepts only the three leading normalized wake-prefix variants", () => {
    expect(verifyWakeTranscript("Hey, Streambot! Skip.")?.command).toBe("skip");
    expect(verifyWakeTranscript("HEY STREAM BOT play local")?.command).toBe(
      "play local",
    );
    expect(verifyWakeTranscript("hey streamboat volume 50")?.command).toBe(
      "volume 50",
    );
    expect(
      verifyWakeTranscript("please tell hey streambot to stop"),
    ).toBeNull();
    expect(verifyWakeTranscript("hey streamer stop")).toBeNull();
  });

  const cases: readonly FakeRealtimeToolCall[] = [
    {
      name: "play",
      arguments: JSON.stringify({
        query: "Local Movie",
        source: "auto",
        placement: "queue",
      }),
    },
    { name: "skip", arguments: "{}" },
    { name: "stop", arguments: "{}" },
    {
      name: "seek",
      arguments: JSON.stringify({ seconds: -30, mode: "relative" }),
    },
    { name: "set_volume", arguments: JSON.stringify({ percent: 70 }) },
    { name: "set_loop", arguments: JSON.stringify({ mode: "track" }) },
    { name: "shuffle", arguments: "{}" },
    // remove/move run against the fixture's empty queue and chapter against a chapterless
    // video: the boundary denial is itself the asserted tool output path.
    { name: "remove", arguments: JSON.stringify({ position: 1 }) },
    { name: "clear", arguments: "{}" },
    { name: "move", arguments: JSON.stringify({ from: 1, to: 2 }) },
    { name: "chapter", arguments: JSON.stringify({ target: "next" }) },
    { name: "subtitles_off", arguments: "{}" },
    { name: "search_library", arguments: JSON.stringify({ query: "Local" }) },
    { name: "list_chapters", arguments: "{}" },
    { name: "get_queue", arguments: "{}" },
    { name: "get_now_playing", arguments: "{}" },
  ];

  for (const toolCall of cases) {
    test(`executes ${toolCall.name} through the actual RealtimeSession`, async () => {
      const result = await run(toolCall);
      await result.promise;
      expect(result.transport.committedAudio).toHaveLength(1);
      expect(result.transport.sentEvents).toContainEqual({
        type: "response.create",
      });
      expect(result.transport.functionOutputs).toHaveLength(1);
      expect(result.transport.closeCount).toBe(1);
      expect(result.speaking).toEqual([true, false]);
      expect(result.replyPackets.length).toBeGreaterThan(0);
    });
  }

  test("sends strict audio-only, manual-turn, privacy-safe session configuration", async () => {
    const result = await run({ name: "get_now_playing", arguments: "{}" });
    await result.promise;
    expect(result.transport.connectOptions?.model).toBe("gpt-realtime-2.1");
    expect(result.transport.connectOptions?.initialSessionConfig).toMatchObject(
      {
        outputModalities: ["audio"],
        parallelToolCalls: false,
        audio: {
          input: {
            transcription: { model: "gpt-transcribe", language: "en" },
            turnDetection: null,
            noiseReduction: null,
          },
          output: { voice: "marin" },
        },
      },
    );
    expect(
      result.transport.connectOptions?.initialSessionConfig?.tools,
    ).toHaveLength(16);
  });

  test("deletes committed audio and inserts verified command text before response", async () => {
    const result = await run({ name: "skip", arguments: "{}" });
    await result.promise;
    expect(result.transport.timeline).toEqual([
      "input_audio_buffer.commit",
      "transcription.completed",
      "conversation.item.delete",
      "conversation.item.create",
      "response.create",
    ]);
    const create = result.transport.sentEvents.find(
      (event) => event.type === "conversation.item.create",
    );
    expect(create?.["item"]).toMatchObject({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "test" }],
    });
  });

  test("rejects a non-wake transcript before response, tools, audio, or ducking", async () => {
    const context = fixture();
    const transport = new FakeRealtimeTransport(
      [{ name: "stop", arguments: "{}" }],
      "success",
      "Ich bin Gott.",
    );
    const result = await runRealtimeVoiceTurn(context.config.voice, {
      pcm16k: new Float32Array(1600),
      activatedAtMs: Date.now(),
      userId: USER,
      service: context.service,
      streamer: context.streamer,
      createTransport: () => transport,
    });
    expect(result.wakeVerified).toBe(false);
    expect(transport.sentEvents).not.toContainEqual({
      type: "response.create",
    });
    expect(transport.functionOutputs).toEqual([]);
    expect(context.events).toEqual([]);
    expect(context.replyPackets).toEqual([]);
    expect(context.speaking).toEqual([]);
    expect(transport.closeCount).toBe(1);
  });

  test("rejects a second mutation in the same wake", async () => {
    const context = fixture();
    const transport = new FakeRealtimeTransport([
      { name: "skip", arguments: "{}" },
      { name: "shuffle", arguments: "{}" },
    ]);
    await runRealtimeVoiceTurn(context.config.voice, {
      pcm16k: new Float32Array(1600),
      activatedAtMs: Date.now(),
      userId: USER,
      service: context.service,
      streamer: context.streamer,
      createTransport: () => transport,
    });
    expect(transport.functionOutputs).toHaveLength(2);
    expect(
      transport.functionOutputs.some((output) =>
        output.includes("Only one playback change"),
      ),
    ).toBe(true);
    expect(context.events).toHaveLength(1);
  });
});

describe("custom Realtime transport failure boundaries", () => {
  test("propagates errors, disconnects, timeouts, and interruption while always cleaning up", async () => {
    for (const behavior of [
      "error",
      "transcription-error",
      // Fails transcription while connect() is still awaited, across a macrotask gap — without
      // early observation in runRealtimeCommandTurn this is an unhandled rejection, which bun
      // fails the test run on, rather than the ordinary turn rejection asserted here.
      "transcription-error-during-connect",
      "disconnect",
      "timeout",
    ] as const) {
      const result = await run({ name: "skip", arguments: "{}" }, behavior);
      await expect(result.promise).rejects.toBeDefined();
      expect(result.transport.closeCount).toBe(1);
      expect(result.transport.sentEvents).not.toContainEqual({
        type: "response.create",
      });
      expect(result.speaking).toEqual([]);
      expect(result.events).toHaveLength(0);
    }

    const responseFailure = await run(
      { name: "stop", arguments: "{}" },
      "response-error",
    );
    await expect(responseFailure.promise).rejects.toThrow(
      "fake response error",
    );
    expect(responseFailure.transport.sentEvents).toContainEqual({
      type: "response.create",
    });
    expect(responseFailure.events).toEqual([]);
    expect(responseFailure.replyPackets).toEqual([]);
    expect(responseFailure.speaking).toEqual([]);

    const context = fixture();
    const controller = new AbortController();
    const transport = new FakeRealtimeTransport([], "timeout");
    const promise = runRealtimeVoiceTurn(context.config.voice, {
      pcm16k: new Float32Array(1600),
      activatedAtMs: Date.now(),
      userId: USER,
      service: context.service,
      streamer: context.streamer,
      signal: controller.signal,
      createTransport: () => transport,
    });
    controller.abort(new Error("operator interruption"));
    await expect(promise).rejects.toThrow("operator interruption");
    expect(transport.closeCount).toBe(1);
    expect(context.events).toHaveLength(0);
  });

  test("bounds the paced reply drain by the transaction timeout", async () => {
    // `audio_stopped` only reports that generation finished; the sink keeps pacing its queue at
    // 20 ms per packet. Awaiting that drain outside the interruption race let a long reply run
    // past VOICE_TRANSACTION_TIMEOUT_MS while still ducked and still holding teardown.
    const context = fixture();
    const controller = new AbortController();
    const audio = new StallingAudio(() => {
      controller.abort(new Error("transaction expired mid-drain"));
    });
    const transport = new FakeRealtimeTransport(
      [{ name: "skip", arguments: "{}" }],
      "success",
    );

    const promise = runRealtimeCommandTurn(context.config.voice, {
      pcm16k: new Float32Array(1600),
      activatedAtMs: Date.now(),
      commands: new DryRunVoiceCommandPort(),
      assistantAudio: audio,
      signal: controller.signal,
      createTransport: () => transport,
    });

    await expect(promise).rejects.toThrow("transaction expired mid-drain");
    expect(audio.finishCount).toBe(1);
    // The sink is cancelled rather than left draining, which truncates its queue and lets the
    // outstanding drain settle — restoring the duck and releasing the teardown hold.
    expect(audio.cancelCount).toBe(1);
    expect(transport.closeCount).toBe(1);
  });

  test("announces a failed transaction, preserves playback state, and returns to wake mode", async () => {
    const context = fixture();
    const announcements: string[] = [];
    const transports = [
      new FakeRealtimeTransport([], "error"),
      new FakeRealtimeTransport([]),
    ];
    let transportIndex = 0;
    const assistant = new VoiceAssistantSession({
      config: context.config,
      models: markerModels(),
      streamer: context.streamer,
      commands: context.commandDeps,
      announce: (message) => {
        announcements.push(message);
        return Promise.resolve();
      },
      holdTeardown: holdTeardownForTest,
      createDecoder: markerDecoder,
      createRealtimeTransport: () => {
        const transport = transports[transportIndex];
        if (transport === undefined) {
          throw new Error("Unexpected third Realtime transport construction");
        }
        transportIndex += 1;
        return transport;
      },
    });
    const listener = context.voiceListener();
    if (listener === null) throw new Error("Voice listener was not installed");
    emitMarkerTurn(listener);
    await Bun.sleep(60);
    expect(announcements).toHaveLength(1);
    expect(announcements[0]).toContain("Playback is still healthy");
    expect(context.events).toHaveLength(0);
    emitMarkerTurn(listener);
    await Bun.sleep(60);
    expect(transportIndex).toBe(2);
    expect(transports[1]?.closeCount).toBe(1);
    expect(context.events).toHaveLength(0);
    assistant.close();
  });
});

describe("VoiceAssistantSession feedback and isolation", () => {
  test("a rate-limited wake speaks the local retry clip instead of dropping silently", async () => {
    const context = fixture();
    // One paced packet's worth of PCM keeps the real sender fast in a unit test.
    const clips: SpokenFeedbackClips = {
      retry: new Uint8Array(960),
      prompt: new Uint8Array(960),
    };
    clips.retry[0] = 1;
    let holds = 0;
    let releases = 0;
    const releaseHold = (): void => {
      releases += 1;
    };
    const assistant = new VoiceAssistantSession({
      config: context.config,
      models: markerModels(),
      streamer: context.streamer,
      commands: context.commandDeps,
      announce: () => Promise.resolve(),
      holdTeardown: () => {
        holds += 1;
        return releaseHold;
      },
      feedbackClips: clips,
      createDecoder: markerDecoder,
      createRealtimeTransport: () => new FakeRealtimeTransport([]),
    });
    const listener = context.voiceListener();
    if (listener === null) throw new Error("Voice listener was not installed");
    // Burst capacity is two: the first two wakes reach the cloud path, the third is limited and
    // must speak the retry clip over normal voice while holding teardown for the drain.
    for (let turn = 0; turn < 2; turn += 1) {
      emitMarkerTurn(listener);
      await Bun.sleep(80);
    }
    const packetsBefore = context.replyPackets.length;
    emitMarkerTurn(listener);
    await Bun.sleep(200);
    expect(context.replyPackets.length).toBeGreaterThan(packetsBefore);
    expect(holds).toBe(3);
    expect(releases).toBe(3);
    assistant.close();
  });

  test("peer userbot audio never reaches the wake detector", async () => {
    const context = fixture();
    const peerId = "300000000000000001";
    const config = loadConfig({
      BOT_TOKEN: "bot",
      USER_TOKENS: "userbot",
      ADMIN_IDS: String(USER),
      VIDEOS_DIR: "/videos",
      VOICE_ASSISTANT_ENABLED: "true",
      OPENAI_API_KEY: "test-key",
      PEER_USERBOT_IDS: peerId,
    });
    let transportConstructions = 0;
    const assistant = new VoiceAssistantSession({
      config,
      models: markerModels(),
      streamer: context.streamer,
      commands: context.commandDeps,
      announce: () => Promise.resolve(),
      holdTeardown: holdTeardownForTest,
      createDecoder: markerDecoder,
      createRealtimeTransport: () => {
        transportConstructions += 1;
        return new FakeRealtimeTransport([]);
      },
    });
    const listener = context.voiceListener();
    if (listener === null) throw new Error("Voice listener was not installed");
    // A peer bot speaking the wake markers is dropped (and its payload zeroed) before the
    // detector; the same markers from a human complete a turn.
    const peerPacket = new Uint8Array([2]);
    listener({ userId: peerId, ssrc: 9, opus: peerPacket });
    expect(peerPacket[0]).toBe(0);
    listener({ userId: peerId, ssrc: 9, opus: new Uint8Array([4]) });
    await Bun.sleep(30);
    expect(transportConstructions).toBe(0);

    emitMarkerTurn(listener);
    await Bun.sleep(60);
    expect(transportConstructions).toBe(1);
    assistant.close();
  });

  test("constructs no transport before wake and exactly one after a completed wake", async () => {
    const context = fixture();
    let transportConstructions = 0;
    const transport = new FakeRealtimeTransport([]);
    const assistant = new VoiceAssistantSession({
      config: context.config,
      models: markerModels(),
      streamer: context.streamer,
      commands: context.commandDeps,
      announce: () => Promise.resolve(),
      holdTeardown: holdTeardownForTest,
      createDecoder: markerDecoder,
      createRealtimeTransport: () => {
        transportConstructions += 1;
        return transport;
      },
    });
    const listener = context.voiceListener();
    if (listener === null) throw new Error("Voice listener was not installed");
    listener({ userId: String(USER), ssrc: 1, opus: new Uint8Array([1]) });
    expect(transportConstructions).toBe(0);
    listener({ userId: String(USER), ssrc: 1, opus: new Uint8Array([2]) });
    expect(transportConstructions).toBe(0);
    listener({ userId: String(USER), ssrc: 1, opus: new Uint8Array([4]) });
    listener({ userId: String(USER), ssrc: 1, opus: new Uint8Array([4]) });
    listener({ userId: String(USER), ssrc: 1, opus: new Uint8Array([4]) });
    listener({ userId: String(USER), ssrc: 1, opus: new Uint8Array([4]) });
    await Bun.sleep(60);
    expect(transportConstructions).toBe(1);
    expect(transport.closeCount).toBe(1);
    assistant.close();
  });
});

describe("local Realtime probe", () => {
  test("uses the production turn with transcription and dry-run commands", async () => {
    const context = await runLocal(
      [
        {
          name: "play",
          arguments: JSON.stringify({
            query: "The Matrix",
            source: "local",
            placement: "queue",
          }),
        },
      ],
      "Hey Streambot, play The Matrix from local.",
    );

    expect(context.result.transcript).toBe(
      "Hey Streambot, play The Matrix from local.",
    );
    expect(context.commands.invocations).toEqual([
      {
        name: "play",
        arguments: {
          query: "The Matrix",
          source: "local",
          placement: "queue",
        },
      },
    ]);
    const sessionConfig =
      context.transport.connectOptions?.initialSessionConfig;
    if (sessionConfig === undefined || !("audio" in sessionConfig)) {
      throw new Error("Expected current Realtime session configuration");
    }
    expect(sessionConfig.audio?.input?.transcription).toEqual({
      model: "gpt-transcribe",
      language: "en",
    });
    expect(sessionConfig.outputModalities).toEqual(["audio"]);
    expect(context.assistantAudio.chunks).toHaveLength(1);
    expect(context.events).toHaveLength(0);
  });

  test("uses the same unprompted transcription gate in production and harness", () => {
    const production = buildRealtimeSessionConfig();
    const harness = buildRealtimeSessionConfig();
    expect(JSON.stringify(harness)).toBe(JSON.stringify(production));
  });

  test("cancels assistant audio when the transcript rejects the wake prefix", async () => {
    const context = await runLocal([], "Ich bin Gott.");
    expect(context.result.wakeVerified).toBe(false);
    expect(context.assistantAudio.cancelCount).toBe(1);
    expect(context.assistantAudio.finishCount).toBe(0);
  });

  test("speaks the local retry clip on a rejected transcript without any response", async () => {
    const clips: SpokenFeedbackClips = {
      retry: new Uint8Array([1, 2, 3, 4]),
      prompt: new Uint8Array([5, 6, 7, 8]),
    };
    const context = await runLocal([], "Ich bin Gott.", clips);
    expect(context.result.wakeVerified).toBe(false);
    // The clip is local: the model never gets a response.create, and the sink drains normally
    // instead of being cancelled into silence.
    expect(context.assistantAudio.chunks).toEqual([clips.retry]);
    expect(context.assistantAudio.cancelCount).toBe(0);
    expect(context.assistantAudio.finishCount).toBe(1);
    expect(context.transport.sentEvents).not.toContainEqual({
      type: "response.create",
    });
  });

  test("answers a bare wake with the local prompt clip instead of a billed response", async () => {
    const clips: SpokenFeedbackClips = {
      retry: new Uint8Array([1, 2, 3, 4]),
      prompt: new Uint8Array([5, 6, 7, 8]),
    };
    const context = await runLocal([], "Hey Streambot", clips);
    expect(context.result.wakeVerified).toBe(true);
    expect(context.result.mutated).toBe(false);
    expect(context.assistantAudio.chunks).toEqual([clips.prompt]);
    expect(context.assistantAudio.finishCount).toBe(1);
    const sentTypes = context.transport.sentEvents.map((event) => event.type);
    expect(sentTypes).not.toContain("conversation.item.create");
    expect(sentTypes).not.toContain("response.create");
  });

  test("records no command for ambiguous speech", async () => {
    const context = await runLocal([], "Hey Streambot, play something.");
    expect(context.commands.invocations).toEqual([]);
    expect(context.result.mutated).toBe(false);
  });

  test("refuses URLs, releases the burned wake, and allows a corrected retry", async () => {
    const context = await runLocal(
      [
        {
          name: "play",
          arguments: JSON.stringify({
            query: "https://youtube.com/watch?v=not-accepted",
            source: "youtube",
            placement: "queue",
          }),
        },
        { name: "skip", arguments: "{}" },
      ],
      "Hey Streambot, play this URL and skip.",
    );
    expect(context.transport.functionOutputs).toHaveLength(2);
    expect(context.transport.functionOutputs[0]).toContain(
      "Say a title instead of a URL",
    );
    // The boundary failure happened before any mutation, so it releases the one-mutation gate
    // and the corrected follow-up executes instead of burning the whole wake.
    expect(context.commands.invocations).toEqual([
      { name: "skip", arguments: {} },
    ]);
    expect(context.result.mutated).toBe(true);
  });
});
