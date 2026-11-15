import { trace } from "@opentelemetry/api";
import { tool } from "@openai/agents/realtime";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  createNoopVoiceMetrics,
  NOOP_VOICE_LOGGER,
  runRealtimeCommandTurn,
  type AssistantAudioSink,
  type RealtimeTurnMetrics,
  type RealtimeTurnOptions,
  type VoiceAttemptHandle,
} from "@shepherdjerred/voice-assistant";
import {
  FakeRealtimeTransport,
  type FakeRealtimeToolCall,
} from "./fake-realtime-transport.ts";

const WAKE_PREFIXES = ["hey streambot", "hey stream bot"];

class RecordingAudioSink implements AssistantAudioSink {
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

function recordingMetrics() {
  const base = createNoopVoiceMetrics().realtimeTurn;
  const turnOutcomes: string[] = [];
  const openAiFailureStages: string[] = [];
  const cloudRequests: { stage: string; outcome: string }[] = [];
  const transcriptOutcomes: string[] = [];
  const wakeToReplyObservations: number[] = [];
  let concurrent = 0;

  const metrics: RealtimeTurnMetrics = {
    ...base,
    concurrentTurns: {
      inc: () => {
        concurrent += 1;
      },
      dec: () => {
        concurrent -= 1;
      },
    },
    turns: {
      inc: ({ outcome }) => {
        turnOutcomes.push(outcome);
      },
    },
    openAiFailures: {
      inc: ({ stage }) => {
        openAiFailureStages.push(stage);
      },
    },
    cloudRequests: {
      inc: ({ stage, outcome }) => {
        cloudRequests.push({ stage, outcome });
      },
    },
    transcriptVerifications: {
      inc: ({ outcome }) => {
        transcriptOutcomes.push(outcome);
      },
    },
    wakeToReplySeconds: {
      observe: (seconds) => {
        wakeToReplyObservations.push(seconds);
      },
    },
  };

  return {
    metrics,
    turnOutcomes,
    openAiFailureStages,
    cloudRequests,
    transcriptOutcomes,
    wakeToReplyObservations,
    concurrent: () => concurrent,
  };
}

function recordingAttempt() {
  const stages: string[] = [];
  const replyTranscripts: string[] = [];
  const cloudOutcomes: string[] = [];
  const transcriptions: {
    transcript: string;
    normalizedCommand: string | null;
    outcome: string;
  }[] = [];

  const handle: VoiceAttemptHandle = {
    captureId: "test-capture",
    traceId: undefined,
    run: async (fn) => await fn(),
    runStage: async (name, _attributes, fn) => {
      stages.push(name);
      const span = trace.getTracer("realtime-turn-test").startSpan(name);
      try {
        return await fn(span);
      } finally {
        span.end();
      }
    },
    recordStage: () => null,
    localVerification: () => null,
    endpoint: () => null,
    transcription: (entry) => {
      transcriptions.push(entry);
    },
    spokenCommand: () => transcriptions.at(-1)?.normalizedCommand ?? null,
    replyTranscript: (text) => {
      replyTranscripts.push(text);
    },
    tool: () => null,
    cloudOutcome: (outcome) => {
      cloudOutcomes.push(outcome);
    },
    cloudUsage: () => null,
    reply: () => null,
    finish: () => null,
  };

  return { handle, stages, replyTranscripts, cloudOutcomes, transcriptions };
}

function createTurnFixture(options: {
  readonly realtimeCalls?: readonly FakeRealtimeToolCall[];
  readonly inputTranscript?: string;
  readonly outputTranscript?: string | null;
  readonly routeVerifiedCommand?: RealtimeTurnOptions["routeVerifiedCommand"];
}) {
  const executedRealtimeTools: string[] = [];
  const transport = new FakeRealtimeTransport(
    options.realtimeCalls ?? [],
    options.inputTranscript ?? "Hey Streambot, pause.",
    options.outputTranscript ?? null,
  );
  const recordedMetrics = recordingMetrics();
  const attempt = recordingAttempt();
  const assistantAudio = new RecordingAudioSink();

  const turnOptions: RealtimeTurnOptions = {
    apiKey: "test-openai-key",
    model: "gpt-realtime-2.1",
    assistantVoice: "marin",
    agentName: "Streambot",
    instructions: "Handle voice commands.",
    transactionTimeoutMs: 2000,
    wakePrefixes: WAKE_PREFIXES,
    tools: ({ mutationGate }) => [
      tool({
        name: "pause",
        description: "Pause playback",
        parameters: z.object({}),
        execute: () => {
          mutationGate.claim();
          executedRealtimeTools.push("pause");
          return "Paused playback.";
        },
      }),
      tool({
        name: "skip",
        description: "Skip current item",
        parameters: z.object({}),
        execute: () => {
          mutationGate.claim();
          executedRealtimeTools.push("skip");
          return "Skipped item.";
        },
      }),
    ],
    ...(options.routeVerifiedCommand === undefined
      ? {}
      : { routeVerifiedCommand: options.routeVerifiedCommand }),
    metrics: recordedMetrics.metrics,
    observability: { logger: NOOP_VOICE_LOGGER, stagePrefix: "test.voice" },
  };

  return {
    transport,
    recordedMetrics,
    attempt,
    assistantAudio,
    executedRealtimeTools,
    run: (signal?: AbortSignal) =>
      runRealtimeCommandTurn(turnOptions, {
        pcm16k: new Float32Array(1600),
        activatedAtMs: Date.now() - 50,
        assistantAudio,
        attempt: attempt.handle,
        createTransport: () => transport,
        ...(signal === undefined ? {} : { signal }),
      }),
  };
}

describe("runRealtimeCommandTurn pre-response routeVerifiedCommand hook", () => {
  test("executes routeVerifiedCommand after wake verification and audio item deletion, sending zero response.create events when handled with toolCalls", async () => {
    const routedCalls: {
      command: string;
      transcript: string;
      aborted: boolean;
    }[] = [];
    let fixtureRef: ReturnType<typeof createTurnFixture> | null = null;
    const narrowRouter: (input: {
      command: string;
      transcript: string;
      signal: AbortSignal;
    }) => Promise<
      | {
          handled: true;
          toolCalls?: readonly string[];
          assistantText?: string;
        }
      | {
          handled: false;
        }
    > = ({ command, transcript, signal }) => {
      fixtureRef?.transport.timeline.push("routeVerifiedCommand");
      routedCalls.push({ command, transcript, aborted: signal.aborted });
      return Promise.resolve({
        handled: true,
        toolCalls: ["pause"],
        assistantText: "Paused.",
      });
    };

    const fixture = createTurnFixture({
      realtimeCalls: [{ name: "pause", arguments: "{}" }],
      inputTranscript: "Hey Streambot, pause.",
      routeVerifiedCommand: narrowRouter,
    });
    fixtureRef = fixture;

    const result = await fixture.run();

    expect(routedCalls).toEqual([
      {
        command: "pause",
        transcript: "Hey Streambot, pause.",
        aborted: false,
      },
    ]);
    expect(fixture.transport.timeline).toEqual([
      "input_audio_buffer.commit",
      "transcription.completed",
      "conversation.item.delete",
      "conversation.item.deleted",
      "routeVerifiedCommand",
    ]);
    expect(fixture.transport.sentEvents.map((event) => event.type)).toEqual([
      "conversation.item.delete",
    ]);
    expect(fixture.transport.sentEvents).not.toContainEqual({
      type: "response.create",
    });
    expect(fixture.executedRealtimeTools).toEqual([]);
    expect(fixture.transport.closeCount).toBe(1);
    expect(fixture.recordedMetrics.concurrent()).toBe(0);
    expect(fixture.assistantAudio.cancelCount).toBe(1);
    expect(fixture.assistantAudio.finishCount).toBe(0);
    expect(fixture.recordedMetrics.turnOutcomes).toEqual(["command"]);
    expect(fixture.attempt.cloudOutcomes).toEqual(["success"]);
    expect(fixture.attempt.replyTranscripts).toEqual(["Paused."]);
    expect(result).toEqual({
      transcript: "Hey Streambot, pause.",
      wakeVerified: true,
      mutated: true,
      normalizedCommand: "pause",
      toolCalls: ["pause"],
      assistantText: "Paused.",
    });
  });

  test("completes cleanly with zero response.create events when routeVerifiedCommand handles non_command speech with empty toolCalls", async () => {
    const fixture = createTurnFixture({
      realtimeCalls: [{ name: "skip", arguments: "{}" }],
      inputTranscript: "Hey Streambot, actually never mind.",
      routeVerifiedCommand: ({ command }) => {
        fixture.transport.timeline.push(`route:${command}`);
        return Promise.resolve({
          handled: true,
          toolCalls: [],
        });
      },
    });

    const result = await fixture.run();

    expect(fixture.transport.timeline).toEqual([
      "input_audio_buffer.commit",
      "transcription.completed",
      "conversation.item.delete",
      "conversation.item.deleted",
      "route:actually never mind",
    ]);
    expect(fixture.transport.sentEvents).not.toContainEqual({
      type: "response.create",
    });
    expect(
      fixture.transport.sentEvents.some(
        (event) => event.type === "conversation.item.create",
      ),
    ).toBe(false);
    expect(fixture.executedRealtimeTools).toEqual([]);
    expect(fixture.transport.closeCount).toBe(1);
    expect(fixture.assistantAudio.cancelCount).toBe(1);
    expect(fixture.assistantAudio.finishCount).toBe(0);
    expect(fixture.recordedMetrics.turnOutcomes).toEqual(["no-command"]);
    expect(result).toEqual({
      transcript: "Hey Streambot, actually never mind.",
      wakeVerified: true,
      mutated: false,
      normalizedCommand: "actually never mind",
      toolCalls: [],
    });
  });

  test("falls through to conversation.item.create and response.create when routeVerifiedCommand returns handled: false", async () => {
    const fixture = createTurnFixture({
      realtimeCalls: [{ name: "skip", arguments: "{}" }],
      inputTranscript: "Hey Streambot, play something moody.",
      outputTranscript: "Skipping to the next track.",
      routeVerifiedCommand: ({ command }) => {
        fixture.transport.timeline.push(`route:${command}`);
        return Promise.resolve({ handled: false });
      },
    });

    const result = await fixture.run();

    expect(fixture.transport.timeline).toEqual([
      "input_audio_buffer.commit",
      "transcription.completed",
      "conversation.item.delete",
      "conversation.item.deleted",
      "route:play something moody",
      "conversation.item.create",
      "conversation.item.added",
      "response.create",
      "function_call_output",
    ]);
    const createdEvent = fixture.transport.sentEvents.find(
      (event) => event.type === "conversation.item.create",
    );
    expect(createdEvent?.["item"]).toMatchObject({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "play something moody" }],
    });
    expect(fixture.executedRealtimeTools).toEqual(["skip"]);
    expect(fixture.assistantAudio.finishCount).toBe(1);
    expect(fixture.assistantAudio.cancelCount).toBe(0);
    expect(fixture.transport.closeCount).toBe(1);
    expect(fixture.recordedMetrics.turnOutcomes).toEqual(["command"]);
    expect(result).toEqual({
      transcript: "Hey Streambot, play something moody.",
      wakeVerified: true,
      mutated: true,
      normalizedCommand: "play something moody",
      toolCalls: ["skip"],
      assistantText: "Skipping to the next track.",
    });
  });
});

describe("runRealtimeCommandTurn wake gates, omitted router, and failure boundaries", () => {
  test("never invokes routeVerifiedCommand when wake verification rejects non-wake speech or sees a bare wake", async () => {
    let routerCalls = 0;
    const rejectedFixture = createTurnFixture({
      inputTranscript: "Can somebody pass the chips?",
      routeVerifiedCommand: () => {
        routerCalls += 1;
        return Promise.resolve({ handled: true, toolCalls: ["pause"] });
      },
    });

    const rejected = await rejectedFixture.run();
    expect(routerCalls).toBe(0);
    expect(rejectedFixture.transport.sentEvents).toEqual([]);
    expect(rejectedFixture.transport.closeCount).toBe(1);
    expect(rejectedFixture.recordedMetrics.turnOutcomes).toEqual([
      "transcript-rejected",
    ]);
    expect(rejected).toEqual({
      transcript: "Can somebody pass the chips?",
      wakeVerified: false,
      mutated: false,
      normalizedCommand: null,
      toolCalls: [],
    });

    const bareWakeFixture = createTurnFixture({
      inputTranscript: "Hey Streambot!",
      routeVerifiedCommand: () => {
        routerCalls += 1;
        return Promise.resolve({ handled: true, toolCalls: [] });
      },
    });

    const bareWake = await bareWakeFixture.run();
    expect(routerCalls).toBe(0);
    expect(bareWakeFixture.transport.sentEvents).toEqual([]);
    expect(bareWakeFixture.transport.closeCount).toBe(1);
    expect(bareWakeFixture.recordedMetrics.turnOutcomes).toEqual(["bare-wake"]);
    expect(bareWake).toEqual({
      transcript: "Hey Streambot!",
      wakeVerified: true,
      mutated: false,
      normalizedCommand: "",
      toolCalls: [],
    });
  });

  test("proceeds directly to conversation.item.create and response.create when routeVerifiedCommand is omitted", async () => {
    const fixture = createTurnFixture({
      realtimeCalls: [{ name: "pause", arguments: "{}" }],
      inputTranscript: "Hey Streambot, pause.",
    });

    const result = await fixture.run();

    expect(fixture.transport.timeline).toEqual([
      "input_audio_buffer.commit",
      "transcription.completed",
      "conversation.item.delete",
      "conversation.item.deleted",
      "conversation.item.create",
      "conversation.item.added",
      "response.create",
      "function_call_output",
    ]);
    expect(fixture.executedRealtimeTools).toEqual(["pause"]);
    expect(result).toEqual({
      transcript: "Hey Streambot, pause.",
      wakeVerified: true,
      mutated: true,
      normalizedCommand: "pause",
      toolCalls: ["pause"],
    });
  });

  test("propagates router errors loudly while cleaning up session and audio, and classifies caller aborts as interrupted", async () => {
    const failingFixture = createTurnFixture({
      inputTranscript: "Hey Streambot, pause.",
      routeVerifiedCommand: () =>
        Promise.reject(new Error("decision classifier HTTP 500")),
    });

    await expect(failingFixture.run()).rejects.toThrow(
      "decision classifier HTTP 500",
    );
    expect(failingFixture.transport.sentEvents).not.toContainEqual({
      type: "response.create",
    });
    expect(failingFixture.transport.closeCount).toBe(1);
    expect(failingFixture.assistantAudio.cancelCount).toBe(1);
    expect(failingFixture.recordedMetrics.openAiFailureStages).toEqual([
      "command-routing",
    ]);
    expect(failingFixture.recordedMetrics.turnOutcomes).toEqual(["error"]);
    expect(failingFixture.recordedMetrics.concurrent()).toBe(0);

    const abortController = new AbortController();
    const routerEntered = Promise.withResolvers<undefined>();
    const abortedFixture = createTurnFixture({
      inputTranscript: "Hey Streambot, pause.",
      routeVerifiedCommand: ({ signal }) => {
        routerEntered.resolve(undefined);
        return new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              reject(
                signal.reason instanceof Error
                  ? signal.reason
                  : new Error("aborted in router"),
              );
            },
            { once: true },
          );
        });
      },
    });

    const runPromise = abortedFixture.run(abortController.signal);
    await routerEntered.promise;
    abortController.abort(new Error("session closed mid-routing"));

    await expect(runPromise).rejects.toThrow("session closed mid-routing");
    expect(abortedFixture.transport.closeCount).toBe(1);
    expect(abortedFixture.assistantAudio.cancelCount).toBe(1);
    expect(abortedFixture.recordedMetrics.openAiFailureStages).toEqual([]);
    expect(abortedFixture.recordedMetrics.turnOutcomes).toEqual([
      "interrupted",
    ]);
  });

  test("drains enqueued reply audio and observes wakeToReplySeconds when a routed command speaks", async () => {
    const fixture = createTurnFixture({
      inputTranscript: "Hey Streambot, what's playing?",
      routeVerifiedCommand: ({ assistantAudio }) => {
        assistantAudio.enqueue(new Uint8Array([1, 2, 3, 4]));
        return Promise.resolve({
          handled: true,
          toolCalls: ["get_now_playing"],
          mutated: false,
          assistantText: "Currently playing The Matrix.",
        });
      },
    });

    const result = await fixture.run();

    expect(fixture.assistantAudio.chunks).toHaveLength(1);
    expect(fixture.assistantAudio.finishCount).toBe(1);
    expect(fixture.assistantAudio.cancelCount).toBe(0);
    expect(
      fixture.recordedMetrics.wakeToReplyObservations.length,
    ).toBeGreaterThan(0);
    expect(fixture.recordedMetrics.turnOutcomes).toEqual(["no-command"]);
    expect(result).toEqual({
      transcript: "Hey Streambot, what's playing?",
      wakeVerified: true,
      mutated: false,
      normalizedCommand: "what s playing",
      toolCalls: ["get_now_playing"],
      assistantText: "Currently playing The Matrix.",
    });
  });
});
