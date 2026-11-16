import { Usage } from "@openai/agents";
import type {
  RealtimeClientMessage,
  RealtimeItem,
  RealtimeTransportEventTypes,
  RealtimeTransportLayer,
  RealtimeTransportLayerConnectOptions,
  TransportToolCallEvent,
} from "@openai/agents/realtime";
import { z } from "zod";

export type FakeRealtimeToolCall = {
  readonly name: string;
  readonly arguments: string;
};

type ConnectionStatus =
  "connected" | "disconnected" | "connecting" | "disconnecting";

const DeletePayloadSchema = z.object({
  type: z.literal("conversation.item.delete"),
  item_id: z.string().min(1),
});

const CreatePayloadSchema = z.object({
  type: z.literal("conversation.item.create"),
  item: z.record(z.string(), z.unknown()),
});

function unsupportedTransportMethod(feature: string): never {
  throw new Error(`Unsupported transport operation in test stub: ${feature}`);
}

export class FakeRealtimeTransport implements RealtimeTransportLayer {
  private readonly handlers = new Map<
    keyof RealtimeTransportEventTypes,
    Set<(...payload: never[]) => void>
  >();
  private completedToolOutputs = 0;
  readonly muted: boolean = false;
  closeCount = 0;
  connectOptions: RealtimeTransportLayerConnectOptions | null = null;
  readonly timeline: string[] = [];
  readonly functionOutputs: string[] = [];
  readonly committedAudio: ArrayBuffer[] = [];
  readonly sentEvents: RealtimeClientMessage[] = [];
  status: ConnectionStatus = "disconnected";

  constructor(
    private readonly scheduledCalls: readonly FakeRealtimeToolCall[],
    private readonly inputTranscript: string | null = "Hey Streambot, pause.",
    private readonly outputTranscript: string | null = null,
  ) {}

  on<K extends keyof RealtimeTransportEventTypes>(
    eventName: K,
    handler: (...args: RealtimeTransportEventTypes[K]) => void,
  ): this {
    const group = this.handlers.get(eventName) ?? new Set();
    group.add(handler);
    this.handlers.set(eventName, group);
    return this;
  }

  off<K extends keyof RealtimeTransportEventTypes>(
    eventName: K,
    handler: (...args: RealtimeTransportEventTypes[K]) => void,
  ): this {
    this.handlers.get(eventName)?.delete(handler);
    return this;
  }

  once<K extends keyof RealtimeTransportEventTypes>(
    eventName: K,
    handler: (...args: RealtimeTransportEventTypes[K]) => void,
  ): this {
    const wrapper = (...payload: RealtimeTransportEventTypes[K]): void => {
      this.off(eventName, wrapper);
      handler(...payload);
    };
    return this.on(eventName, wrapper);
  }

  emit<K extends keyof RealtimeTransportEventTypes>(
    eventName: K,
    ...payload: RealtimeTransportEventTypes[K]
  ): boolean {
    const group = this.handlers.get(eventName);
    if (group === undefined || group.size === 0) return false;
    for (const handler of group) {
      Reflect.apply(handler, undefined, payload);
    }
    return true;
  }

  connect(options: RealtimeTransportLayerConnectOptions): Promise<void> {
    this.status = "connected";
    this.connectOptions = options;
    this.emit("connection_change", "connected");
    return Promise.resolve();
  }

  sendEvent(message: RealtimeClientMessage): void {
    this.sentEvents.push(message);
    this.timeline.push(message.type);

    switch (message.type) {
      case "conversation.item.delete": {
        const parsedDelete = DeletePayloadSchema.parse(message);
        queueMicrotask(() => {
          this.timeline.push("conversation.item.deleted");
          this.emit("*", {
            type: "conversation.item.deleted",
            event_id: `del_${parsedDelete.item_id}`,
            item_id: parsedDelete.item_id,
          });
        });
        return;
      }
      case "conversation.item.create": {
        const parsedCreate = CreatePayloadSchema.parse(message);
        queueMicrotask(() => {
          this.timeline.push("conversation.item.added");
          this.emit("*", {
            type: "conversation.item.added",
            event_id: "add_verified_item",
            item: parsedCreate.item,
          });
        });
        return;
      }
      case "response.create": {
        this.beginScheduledResponse();
        return;
      }
      default: {
        return;
      }
    }
  }

  requestResponse(): void {
    this.sendEvent({ type: "response.create" });
  }

  sendMessage(
    _text: Parameters<RealtimeTransportLayer["sendMessage"]>[0],
    _meta: Parameters<RealtimeTransportLayer["sendMessage"]>[1],
  ): void {
    unsupportedTransportMethod("sendMessage");
  }

  addImage(): void {
    unsupportedTransportMethod("addImage");
  }

  sendAudio(pcmBuffer: ArrayBuffer, options: { commit?: boolean }): void {
    if (options.commit !== true) {
      throw new Error("Expected manual commit=true on sendAudio");
    }
    this.committedAudio.push(pcmBuffer);
    this.timeline.push("input_audio_buffer.commit");
    const spokenText = this.inputTranscript;
    if (spokenText === null) return;
    queueMicrotask(() => {
      this.timeline.push("transcription.completed");
      this.emit("*", {
        type: "conversation.item.input_audio_transcription.completed",
        event_id: "evt_transcription_done",
        item_id: "itm_audio_in",
        content_index: 0,
        transcript: spokenText,
        usage: {
          type: "tokens",
          input_tokens: 10,
          output_tokens: 4,
          total_tokens: 14,
          input_token_details: { audio_tokens: 10, text_tokens: 0 },
        },
      });
    });
  }

  updateSessionConfig(): void {
    /* Session config is asserted via connectOptions. */
  }

  close(): void {
    this.closeCount += 1;
    this.status = "disconnected";
    this.emit("connection_change", "disconnected");
  }

  mute(): void {
    /* Server transport stub has no microphone track. */
  }

  sendFunctionCallOutput(
    _call: TransportToolCallEvent,
    resultText: string,
    _triggerReply: boolean,
  ): void {
    this.functionOutputs.push(resultText);
    this.timeline.push("function_call_output");
    this.completedToolOutputs += 1;
    if (this.completedToolOutputs === this.scheduledCalls.length) {
      queueMicrotask(() => {
        this.emitCompletedResponse("resp_stub");
      });
    }
  }

  interrupt(): void {
    this.emit("audio_interrupted");
  }

  resetHistory(_prev: RealtimeItem[], _next: RealtimeItem[]): void {
    /* Stateless test stub. */
  }

  sendMcpResponse(
    _request: Parameters<RealtimeTransportLayer["sendMcpResponse"]>[0],
    _approved: boolean,
  ): void {
    unsupportedTransportMethod("sendMcpResponse");
  }

  private beginScheduledResponse(): void {
    const responseId = "resp_stub";
    this.emit("turn_started", {
      type: "response_started",
      providerData: { response: { id: responseId } },
    });
    for (const [idx, toolCall] of this.scheduledCalls.entries()) {
      this.emit("function_call", {
        type: "function_call",
        name: toolCall.name,
        arguments: toolCall.arguments,
        callId: `call_${String(idx)}`,
        responseId,
      });
    }
    if (this.scheduledCalls.length === 0) {
      queueMicrotask(() => {
        this.emitCompletedResponse(responseId);
      });
    }
  }

  private emitCompletedResponse(responseId: string): void {
    if (this.outputTranscript !== null) {
      this.emit("*", {
        type: "response.output_audio_transcript.done",
        event_id: "evt_out_transcript",
        response_id: responseId,
        item_id: "itm_audio_out",
        output_index: 0,
        content_index: 0,
        transcript: this.outputTranscript,
      });
    }
    const sampleFrame = Uint8Array.of(1, ...new Uint8Array(959));
    this.emit("audio", {
      type: "audio",
      data: sampleFrame.buffer,
      responseId,
    });
    const tokenSummary = {
      requests: 1,
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
      inputTokensDetails: { audio_tokens: 10 },
      outputTokensDetails: { audio_tokens: 6 },
    };
    this.emit("usage_update", new Usage(tokenSummary));
    this.emit("turn_done", {
      type: "response_done",
      response: {
        id: responseId,
        usage: tokenSummary,
        output: [],
      },
    });
    this.emit("audio_done");
  }
}
