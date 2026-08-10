import { RuntimeEventEmitter, Usage } from "@openai/agents";
import type {
  RealtimeClientMessage,
  RealtimeItem,
  RealtimeTransportEventTypes,
  RealtimeTransportLayer,
  RealtimeTransportLayerConnectOptions,
  TransportToolCallEvent,
} from "@openai/agents/realtime";
import { z } from "zod";

const DeleteItemEventSchema = z.object({
  type: z.literal("conversation.item.delete"),
  item_id: z.string().min(1),
});

const CreateItemEventSchema = z.object({
  type: z.literal("conversation.item.create"),
  item: z.object({
    id: z.string().min(1),
    type: z.literal("message"),
    role: z.literal("user"),
    content: z.array(
      z.object({ type: z.literal("input_text"), text: z.string() }),
    ),
  }),
});

export type FakeRealtimeToolCall = {
  readonly name: string;
  readonly arguments: string;
};

export class FakeRealtimeTransport
  extends RuntimeEventEmitter<RealtimeTransportEventTypes>
  implements RealtimeTransportLayer
{
  status: "connected" | "disconnected" | "connecting" | "disconnecting" =
    "disconnected";
  readonly muted = false;
  readonly sentEvents: RealtimeClientMessage[] = [];
  readonly committedAudio: ArrayBuffer[] = [];
  readonly functionOutputs: string[] = [];
  readonly timeline: string[] = [];
  connectOptions: RealtimeTransportLayerConnectOptions | null = null;
  closeCount = 0;
  private outputCount = 0;

  constructor(
    private readonly calls: readonly FakeRealtimeToolCall[],
    private readonly behavior:
      | "success"
      | "error"
      | "transcription-error"
      | "response-error"
      | "disconnect"
      | "timeout" = "success",
    private readonly inputTranscript: string | null = "Hey Streambot test",
  ) {
    super();
  }

  connect(options: RealtimeTransportLayerConnectOptions): Promise<void> {
    this.status = "connected";
    this.connectOptions = options;
    this.emit("connection_change", "connected");
    return Promise.resolve();
  }

  sendEvent(event: RealtimeClientMessage): void {
    this.sentEvents.push(event);
    this.timeline.push(event.type);
    const deletion = DeleteItemEventSchema.safeParse(event);
    if (deletion.success) {
      const itemId = deletion.data.item_id;
      queueMicrotask(() => {
        this.emit("*", {
          type: "conversation.item.deleted",
          event_id: `deleted-${itemId}`,
          item_id: itemId,
        });
      });
      return;
    }
    if (event.type === "conversation.item.delete") {
      throw new Error("Invalid conversation item deletion event");
    }
    const creation = CreateItemEventSchema.safeParse(event);
    if (creation.success) {
      queueMicrotask(() => {
        this.emit("*", {
          type: "conversation.item.created",
          event_id: "created-verified-command",
          item: creation.data.item,
        });
      });
      return;
    }
    if (event.type === "conversation.item.create") {
      throw new Error("Invalid verified command item event");
    }
    if (event.type !== "response.create") return;
    if (this.behavior === "timeout") return;
    if (this.behavior === "error" || this.behavior === "response-error") {
      if (this.behavior === "response-error") {
        queueMicrotask(() =>
          this.emit("error", {
            type: "error",
            error: new Error("fake response error"),
          }),
        );
        return;
      }
      queueMicrotask(() =>
        this.emit("error", {
          type: "error",
          error: new Error("fake transport error"),
        }),
      );
      return;
    }
    if (this.behavior === "disconnect") {
      queueMicrotask(() => {
        this.status = "disconnected";
        this.emit("connection_change", "disconnected");
        this.emit("error", {
          type: "error",
          error: new Error("fake transport disconnected"),
        });
      });
      return;
    }
    const responseId = "fake-response";
    this.emit("turn_started", {
      type: "response_started",
      providerData: { response: { id: responseId } },
    });
    for (const [index, call] of this.calls.entries()) {
      this.emit("function_call", {
        type: "function_call",
        name: call.name,
        arguments: call.arguments,
        callId: `fake-call-${String(index)}`,
        responseId,
      });
    }
    if (this.calls.length === 0)
      queueMicrotask(() => {
        this.complete(responseId);
      });
  }

  requestResponse(): void {
    this.sendEvent({ type: "response.create" });
  }

  sendMessage(
    _message: Parameters<RealtimeTransportLayer["sendMessage"]>[0],
    _otherEventData: Parameters<RealtimeTransportLayer["sendMessage"]>[1],
  ): void {
    throw new Error("Fake Realtime transport does not accept text messages");
  }

  addImage(): void {
    throw new Error("Fake Realtime transport does not accept images");
  }

  sendAudio(audio: ArrayBuffer, options: { commit?: boolean }): void {
    if (options.commit !== true)
      throw new Error("Voice turn audio must be committed manually");
    this.committedAudio.push(audio);
    this.timeline.push("input_audio_buffer.commit");
    if (this.behavior === "timeout") return;
    if (this.behavior === "transcription-error") {
      queueMicrotask(() => {
        this.emit("*", {
          type: "conversation.item.input_audio_transcription.failed",
          event_id: "fake-transcription-failed",
          item_id: "fake-input",
          content_index: 0,
          error: { type: "server_error", message: "fake transcription error" },
        });
      });
      return;
    }
    if (this.behavior === "error") {
      queueMicrotask(() =>
        this.emit("error", {
          type: "error",
          error: new Error("fake transport error"),
        }),
      );
      return;
    }
    if (this.behavior === "disconnect") {
      queueMicrotask(() => {
        this.status = "disconnected";
        this.emit("connection_change", "disconnected");
        this.emit("error", {
          type: "error",
          error: new Error("fake transport disconnected"),
        });
      });
      return;
    }
    if (this.inputTranscript !== null) {
      queueMicrotask(() => {
        this.timeline.push("transcription.completed");
        this.emit("*", {
          type: "conversation.item.input_audio_transcription.completed",
          event_id: "fake-transcription",
          item_id: "fake-input",
          content_index: 0,
          transcript: this.inputTranscript,
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
  }

  updateSessionConfig(): void {
    /* Initial configuration is captured by connect(). */
  }

  close(): void {
    this.closeCount += 1;
    this.status = "disconnected";
    this.emit("connection_change", "disconnected");
  }

  mute(): void {
    /* Server WebSocket test transport has no input track to mute. */
  }

  sendFunctionCallOutput(
    _toolCall: TransportToolCallEvent,
    output: string,
    _startResponse: boolean,
  ): void {
    this.functionOutputs.push(output);
    this.outputCount += 1;
    if (this.outputCount === this.calls.length) {
      queueMicrotask(() => {
        this.complete("fake-response");
      });
    }
  }

  interrupt(): void {
    this.emit("audio_interrupted");
  }

  resetHistory(_oldHistory: RealtimeItem[], _newHistory: RealtimeItem[]): void {
    /* No retained history in the deterministic transport. */
  }

  sendMcpResponse(
    _approvalRequest: Parameters<RealtimeTransportLayer["sendMcpResponse"]>[0],
    _approved: boolean,
  ): void {
    throw new Error("MCP is not available to Streambot");
  }

  private complete(responseId: string): void {
    const audio = new Uint8Array(960);
    audio[0] = 1;
    this.emit("audio", { type: "audio", data: audio.buffer, responseId });
    const usage = new Usage({
      requests: 1,
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
      inputTokensDetails: { audio_tokens: 10 },
      outputTokensDetails: { audio_tokens: 6 },
    });
    this.emit("usage_update", usage);
    this.emit("turn_done", {
      type: "response_done",
      response: {
        id: responseId,
        usage: {
          requests: 1,
          inputTokens: 12,
          outputTokens: 8,
          totalTokens: 20,
          inputTokensDetails: { audio_tokens: 10 },
          outputTokensDetails: { audio_tokens: 6 },
        },
        output: [],
      },
    });
    this.emit("audio_done");
  }
}
