import type { PassThrough, Readable } from "node:stream";

export type VoiceTarget = {
  readonly guildId: string;
  readonly channelId: string;
};

export type EncoderHandles = {
  readonly sink: PassThrough;
  readonly output: Readable;
  readonly playing: Promise<void>;
};

export type StreamTeardownReason =
  | "userStop"
  | "undesired"
  | "voiceDetached"
  | "guildRemoved"
  | "channelDeleted"
  | "producerFailed"
  | "shutdown";

export type RawGoLiveContext = {
  readonly voiceTarget: VoiceTarget;
  readonly frameSink: PassThrough | null;
  readonly encoder: EncoderHandles | null;
  readonly retries: number;
  readonly maxRetries: number;
  readonly lastError: string | null;
  readonly teardownReason: StreamTeardownReason | null;
};

export type RawGoLiveInput = {
  readonly voiceTarget: VoiceTarget;
  readonly maxRetries?: number;
};

export type RawGoLiveEvent =
  | { readonly type: "START" }
  | { readonly type: "STOP" }
  | { readonly type: "VOICE_TARGET_MOVED"; readonly target: VoiceTarget }
  | { readonly type: "STREAMER_VOICE_DETACHED"; readonly reason?: string }
  | { readonly type: "GUILD_REMOVED"; readonly guildId: string }
  | { readonly type: "CHANNEL_DELETED"; readonly channelId: string }
  | { readonly type: "PRODUCER_FAILED"; readonly reason: string }
  | { readonly type: "SHUTDOWN" };

export type DesiredStreamContext = {
  readonly desired: boolean;
  readonly voiceTarget: VoiceTarget;
  readonly frameSink: PassThrough | null;
  readonly maxRetries: number;
  readonly teardownReason: StreamTeardownReason | null;
};

export type DesiredStreamInput = {
  readonly voiceTarget: VoiceTarget;
  readonly maxRetries?: number;
};

export type DesiredStreamEvent =
  | { readonly type: "SET_DESIRED"; readonly desired: boolean }
  | { readonly type: "VOICE_TARGET_MOVED"; readonly target: VoiceTarget }
  | { readonly type: "STREAMER_VOICE_DETACHED"; readonly reason?: string }
  | { readonly type: "GUILD_REMOVED"; readonly guildId: string }
  | { readonly type: "CHANNEL_DELETED"; readonly channelId: string }
  | { readonly type: "PRODUCER_FAILED"; readonly reason: string }
  | { readonly type: "SHUTDOWN" };

export type DiscordTopologyEvent =
  | { readonly type: "VOICE_TARGET_MOVED"; readonly target: VoiceTarget }
  | { readonly type: "STREAMER_VOICE_DETACHED"; readonly reason?: string }
  | { readonly type: "GUILD_REMOVED"; readonly guildId: string }
  | { readonly type: "CHANNEL_DELETED"; readonly channelId: string };

export type GatewayHealthEvent =
  | { readonly type: "COMMAND_GATEWAY_READY" }
  | { readonly type: "COMMAND_GATEWAY_RECONNECTING" }
  | { readonly type: "USERBOT_GATEWAY_READY"; readonly userId: string }
  | { readonly type: "USERBOT_GATEWAY_RECONNECTING"; readonly userId: string };

export type ProducerHealthEvent =
  | { readonly type: "PRODUCER_HEALTHY" }
  | { readonly type: "PRODUCER_STALLED"; readonly reason: string }
  | { readonly type: "PRODUCER_FAILED"; readonly reason: string };

export type StreamLifecycleEvent =
  | RawGoLiveEvent
  | DesiredStreamEvent
  | DiscordTopologyEvent
  | GatewayHealthEvent
  | ProducerHealthEvent;

export type RawGoLiveDeps = {
  readonly joinVoice: (
    input: { readonly target: VoiceTarget },
    signal: AbortSignal,
  ) => Promise<void>;
  readonly prepareEncoder: () => Promise<EncoderHandles>;
  readonly runStream: (
    handles: { readonly output: Readable; readonly playing: Promise<void> },
    signal: AbortSignal,
  ) => Promise<void>;
  readonly leaveVoice: (playing: Promise<void> | null) => Promise<void>;
  readonly onFailure?: (failure: {
    readonly attempt: number;
    readonly maxRetries: number;
    readonly error: string | null;
  }) => void;
  readonly retryDelayMs?: number;
};
