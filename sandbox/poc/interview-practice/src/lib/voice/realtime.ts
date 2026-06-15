import { z } from "zod/v4";
import type { Logger } from "#logger";

export type RealtimeEventHandler = (event: RealtimeServerEvent) => void;

export type RealtimeClientEvent =
  | { type: "session.update"; session: RealtimeSessionConfig }
  | { type: "input_audio_buffer.append"; audio: string }
  | { type: "input_audio_buffer.commit" }
  | { type: "response.create" }
  | {
      type: "conversation.item.create";
      item: ConversationItem | FunctionCallOutputItem;
    };

export type FunctionCallOutputItem = {
  type: "function_call_output";
  call_id: string;
  output: string;
};

export type ConversationItem = {
  type: "message";
  role: "user" | "assistant" | "system";
  content: { type: "input_text" | "text"; text: string }[];
};

export type RealtimeServerEvent =
  | { type: "session.created"; session: Record<string, unknown> }
  | { type: "session.updated"; session: Record<string, unknown> }
  | { type: "error"; error: { type: string; code: string; message: string } }
  | {
      type: "conversation.item.input_audio_transcription.completed";
      transcript: string;
      item_id: string;
    }
  | { type: "response.audio.delta"; delta: string; response_id: string }
  | { type: "response.audio.done"; response_id: string }
  | {
      type: "response.function_call_arguments.done";
      call_id: string;
      name: string;
      arguments: string;
      item_id: string;
    }
  | { type: "response.done"; response: ResponseDonePayload }
  | { type: "response.text.delta"; delta: string }
  | { type: "response.text.done"; text: string }
  | { type: "input_audio_buffer.speech_started" }
  | { type: "input_audio_buffer.speech_stopped" };

export type ResponseDonePayload = {
  id: string;
  status: string;
  output: {
    type: string;
    role?: string | undefined;
    content?:
      | {
          type: string;
          text?: string | undefined;
          transcript?: string | undefined;
        }[]
      | undefined;
  }[];
  usage?:
    | {
        total_tokens: number;
        input_tokens: number;
        output_tokens: number;
      }
    | undefined;
};

export type RealtimeSessionConfig = {
  model?: string;
  modalities?: string[];
  voice?: string;
  instructions?: string;
  tools?: {
    type: "function";
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }[];
  input_audio_transcription?: {
    model: string;
  };
  turn_detection?: {
    type: "server_vad";
    threshold?: number;
    silence_duration_ms?: number;
    prefix_padding_ms?: number;
  } | null;
};

export type RealtimeCallbacks = {
  onTranscript?: (transcript: string, itemId: string) => void;
  onAudioDelta?: (base64Audio: string, responseId: string) => void;
  onAudioDone?: (responseId: string) => void;
  onFunctionCall?: (
    callId: string,
    name: string,
    args: string,
    itemId: string,
  ) => void;
  onResponseDone?: (response: ResponseDonePayload) => void;
  onError?: (error: { type: string; code: string; message: string }) => void;
  onSpeechStarted?: () => void;
  onSpeechStopped?: () => void;
};

export type RealtimeClient = {
  connect: (apiKey: string, config: RealtimeSessionConfig) => Promise<void>;
  disconnect: () => void;
  sendSessionUpdate: (config: RealtimeSessionConfig) => void;
  sendAudio: (pcmBase64: string) => void;
  commitAudio: () => void;
  sendFunctionResult: (callId: string, result: string) => void;
  isConnected: () => boolean;
  on: (callbacks: RealtimeCallbacks) => void;
};

const REALTIME_URL = "wss://api.openai.com/v1/realtime";
const MAX_RECONNECT_ATTEMPTS = 3;
const BASE_RECONNECT_DELAY_MS = 1000;

const ServerEventTypeSchema = z.enum([
  "session.created",
  "session.updated",
  "error",
  "conversation.item.input_audio_transcription.completed",
  "response.audio.delta",
  "response.audio.done",
  "response.function_call_arguments.done",
  "response.done",
  "response.text.delta",
  "response.text.done",
  "input_audio_buffer.speech_started",
  "input_audio_buffer.speech_stopped",
]);

const EventRecordSchema = z.record(z.string(), z.unknown());
const UsageSchema = z.object({
  total_tokens: z.number(),
  input_tokens: z.number(),
  output_tokens: z.number(),
});
const ContentItemSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
  transcript: z.string().optional(),
});
const OutputItemSchema = z.object({
  type: z.string(),
  role: z.string().optional(),
  content: z.array(ContentItemSchema).optional(),
});
const ResponsePayloadSchema = z.object({
  id: z.string(),
  status: z.string(),
  output: z.array(OutputItemSchema),
  usage: UsageSchema.optional(),
});
const ErrorPayloadSchema = z.object({
  type: z.string(),
  code: z.string(),
  message: z.string(),
});

function str(record: Record<string, unknown>, key: string): string {
  const val = record[key];
  return typeof val === "string" ? val : "";
}

function dispatchSimpleEvent(
  eventType: string,
  record: Record<string, unknown>,
  callbacks: RealtimeCallbacks,
): boolean {
  switch (eventType) {
    case "session.created":
    case "session.updated":
    case "response.text.delta":
    case "response.text.done":
      return true;

    case "input_audio_buffer.speech_started":
      callbacks.onSpeechStarted?.();
      return true;

    case "input_audio_buffer.speech_stopped":
      callbacks.onSpeechStopped?.();
      return true;

    case "conversation.item.input_audio_transcription.completed":
      callbacks.onTranscript?.(
        str(record, "transcript"),
        str(record, "item_id"),
      );
      return true;

    case "response.audio.delta":
      callbacks.onAudioDelta?.(
        str(record, "delta"),
        str(record, "response_id"),
      );
      return true;

    case "response.audio.done":
      callbacks.onAudioDone?.(str(record, "response_id"));
      return true;

    case "response.function_call_arguments.done":
      callbacks.onFunctionCall?.(
        str(record, "call_id"),
        str(record, "name"),
        str(record, "arguments"),
        str(record, "item_id"),
      );
      return true;

    default:
      return false;
  }
}

function dispatchParsedEvent(
  eventType: string,
  record: Record<string, unknown>,
  callbacks: RealtimeCallbacks,
  logger: Logger,
): void {
  switch (eventType) {
    case "error": {
      const errorResult = ErrorPayloadSchema.safeParse(record["error"]);
      const error = errorResult.success
        ? errorResult.data
        : { type: "unknown", code: "unknown", message: "Unknown error" };
      logger.error("realtime_error", error);
      callbacks.onError?.(error);
      break;
    }

    case "response.done": {
      const responseResult = ResponsePayloadSchema.safeParse(
        record["response"],
      );
      if (responseResult.success) {
        callbacks.onResponseDone?.(responseResult.data);
      }
      break;
    }

    default:
      break;
  }
}

export function createRealtimeClient(logger: Logger): RealtimeClient {
  let ws: WebSocket | null = null;
  let callbacks: RealtimeCallbacks = {};
  let connected = false;
  let reconnectAttempts = 0;
  let currentApiKey = "";
  let currentConfig: RealtimeSessionConfig | null = null;

  function send(event: RealtimeClientEvent): void {
    if (ws?.readyState !== WebSocket.OPEN) {
      logger.warn("ws_send_failed", {
        reason: "not connected",
        eventType: event.type,
      });
      return;
    }
    ws.send(JSON.stringify(event));
  }

  function handleServerEvent(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      logger.error("ws_parse_error", { raw: raw.slice(0, 200) });
      return;
    }

    const recordResult = EventRecordSchema.safeParse(parsed);
    if (!recordResult.success) return;

    const record = recordResult.data;
    const typeResult = ServerEventTypeSchema.safeParse(record["type"]);
    if (!typeResult.success) {
      logger.debug("ws_unhandled_event", { type: record["type"] });
      return;
    }

    logger.debug("ws_event", { type: typeResult.data });
    if (!dispatchSimpleEvent(typeResult.data, record, callbacks)) {
      dispatchParsedEvent(typeResult.data, record, callbacks, logger);
    }
  }

  async function attemptReconnect(): Promise<void> {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      logger.error("ws_reconnect_exhausted", {
        attempts: reconnectAttempts,
      });
      return;
    }

    reconnectAttempts++;
    const delay = BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts - 1);
    logger.info("ws_reconnecting", {
      attempt: reconnectAttempts,
      delayMs: delay,
    });

    await new Promise((resolve) => setTimeout(resolve, delay));

    if (currentConfig !== null) {
      try {
        await connectInternal(currentApiKey, currentConfig);
      } catch (error) {
        logger.error("ws_reconnect_failed", {
          attempt: reconnectAttempts,
          error: error instanceof Error ? error.message : String(error),
        });
        await attemptReconnect();
      }
    }
  }

  async function connectInternal(
    apiKey: string,
    config: RealtimeSessionConfig,
  ): Promise<void> {
    const model = config.model ?? "gpt-4o-realtime-preview";
    const url = `${REALTIME_URL}?model=${encodeURIComponent(model)}`;

    return new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "OpenAI-Beta": "realtime=v1",
        },
      });

      const openTimeout = setTimeout(() => {
        socket.close();
        reject(new Error("WebSocket connection timeout (10s)"));
      }, 10_000);

      socket.addEventListener("open", () => {
        clearTimeout(openTimeout);
        ws = socket;
        connected = true;
        reconnectAttempts = 0;

        logger.info("ws_connected", { model });

        send({
          type: "session.update",
          session: config,
        });

        resolve();
      });

      socket.addEventListener("message", (event) => {
        const data =
          typeof event.data === "string" ? event.data : String(event.data);
        handleServerEvent(data);
      });

      socket.addEventListener("close", (event) => {
        clearTimeout(openTimeout);
        const wasConnected = connected;
        connected = false;
        ws = null;

        logger.info("ws_closed", {
          code: event.code,
          reason: event.reason,
          wasConnected,
        });

        if (wasConnected && event.code !== 1000) {
          void attemptReconnect();
        }
      });

      socket.addEventListener("error", (event) => {
        clearTimeout(openTimeout);
        logger.error("ws_error", {
          message: event instanceof ErrorEvent ? event.message : "unknown",
        });

        if (!connected) {
          reject(
            new Error(
              event instanceof ErrorEvent
                ? event.message
                : "WebSocket connection failed",
            ),
          );
        }
      });
    });
  }

  return {
    async connect(apiKey, config) {
      currentApiKey = apiKey;
      currentConfig = config;
      reconnectAttempts = 0;
      await connectInternal(apiKey, config);
    },

    disconnect() {
      if (ws !== null) {
        connected = false;
        ws.close(1000, "client disconnect");
        ws = null;
      }
    },

    sendSessionUpdate(config) {
      send({ type: "session.update", session: config });
    },

    sendAudio(pcmBase64) {
      send({ type: "input_audio_buffer.append", audio: pcmBase64 });
    },

    commitAudio() {
      send({ type: "input_audio_buffer.commit" });
    },

    sendFunctionResult(callId, result) {
      send({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId,
          output: result,
        },
      });
      send({ type: "response.create" });
    },

    isConnected() {
      return connected;
    },

    on(cbs) {
      callbacks = cbs;
    },
  };
}
