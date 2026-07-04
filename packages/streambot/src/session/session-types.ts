import type { Actor } from "xstate";
import type { createPlaybackMachine } from "@shepherdjerred/streambot/machine/playback-machine.ts";
import type {
  PlaybackEvent,
  PlaybackInput,
} from "@shepherdjerred/streambot/machine/types.ts";
import type { PlaybackView } from "@shepherdjerred/streambot/discord/command-handler.ts";
import type { StatusReporter } from "@shepherdjerred/streambot/discord/status-reporter.ts";
import type { UserbotEntry } from "@shepherdjerred/streambot/pool/userbot-pool.ts";
import type {
  ChannelId,
  GuildId,
} from "@shepherdjerred/streambot/types/ids.ts";

/** How often to checkpoint a session's playback state to disk for resume. */
export const CHECKPOINT_MS = 10 * 1000;
/** Once a resume has streamed healthily this long, mark it confirmed (reset the crash-loop counter). */
export const RESUME_CONFIRM_MS = 30 * 1000;
/** Skip resuming an item that has crashed the bot this many consecutive boots (crash-loop guard). */
export const MAX_RESUME_ATTEMPTS = 3;

type PlaybackActor = Actor<ReturnType<typeof createPlaybackMachine>>;

/** The slice of a session the command handler drives — bound to one guild + voice channel. */
export type SessionHandle = {
  dispatch: (event: PlaybackEvent) => void;
  view: () => PlaybackView;
  setVolume: (percent: number) => Promise<boolean>;
  seek: (seconds: number) => Promise<boolean>;
};

export type Session = {
  key: string;
  readonly guildId: GuildId;
  voiceChannelId: ChannelId;
  readonly statusChannelId: ChannelId | null;
  readonly entry: UserbotEntry;
  readonly actor: PlaybackActor;
  readonly reporter: StatusReporter;
  unsubscribe: () => void;
  /** True once the machine has left `idle` at least once, so we don't tear down on the boot snapshot. */
  hasStarted: boolean;
  // Per-session resume bookkeeping (mirrors the former single-instance loop in index.ts).
  persistResumeKey: string | null;
  persistResumeAttempts: number;
  resumeConfirmed: boolean;
  readonly bootAtMs: number;
  lastKnownPositionSeconds: number;
  checkpointTimer: ReturnType<typeof setInterval> | null;
  snapshotTail: Promise<void>;
  /** Set at teardown so a queued checkpoint can't re-write the file after we delete it. */
  torndown: boolean;
  // Voice-loss recovery bookkeeping.
  /** Keep the resume state file at teardown (transient voice loss / unconfirmed recovery). */
  preserveStateOnTeardown: boolean;
  /** Reconnect attempts already consumed for the current voice-loss incident (0 = fresh session). */
  reconnectAttempts: number;
  /** True when this session was spawned by the voice-loss reconnect path (not boot / manual play). */
  readonly recoveredFromVoiceLoss: boolean;
  /** Sync re-entrancy latch: set when a voice-loss recovery has begun for this session. */
  voiceRecoveryStarted: boolean;
};

/** Everything needed to spin up a session actor (manual play, boot resume, or reconnect). */
export type SpawnParams = {
  guildId: GuildId;
  voiceChannelId: ChannelId;
  statusChannelId: ChannelId | null;
  entry: UserbotEntry;
  input: PlaybackInput;
  resumeKey: string | null;
  resumeAttempts: number;
  seekSeconds?: number;
  recoveredFromVoiceLoss?: boolean;
  reconnectAttempts?: number;
  preserveStateOnTeardown?: boolean;
};

export const IDLE_VIEW: PlaybackView = {
  state: "idle",
  current: null,
  queue: [],
  loop: "off",
  volume: 100,
  positionSeconds: null,
};

/** A no-op handle for commands that target a guild/channel with no active session. */
export const EMPTY_HANDLE: SessionHandle = {
  dispatch: () => {
    /* no active session: ignore control events */
  },
  view: () => IDLE_VIEW,
  setVolume: () => Promise.resolve(false),
  seek: () => Promise.resolve(false),
};

export function keyOf(guildId: GuildId, channelId: ChannelId): string {
  return `${guildId}:${channelId}`;
}
