/**
 * Pure control logic for the player card's buttons and chapter menu: the `customId` namespace and
 * the permission matrix. Kept discord.js-free (like `queue-text.ts` and `buildMenuOptions` in
 * `subtitle-menu.ts`) so every action × role combination is directly unit-testable without a
 * gateway. `player-card-manager.ts` applies the returned outcome.
 *
 * Permission tiers, from loosest to tightest:
 *
 * - **Anyone in the voice channel** — seek (±30s, chapter jump), volume, loop, shuffle, queue.
 *   These affect what the channel is collectively watching, and everyone present is watching it.
 *   Loop and shuffle are ungated on the slash side too, so this is no looser than `/stream`.
 * - **Requester or admin** — skip, subtitles. Mirrors `handleSkip` / `handleSubtitles` in
 *   `command-handler.ts`.
 * - **Admin only** — stop. Mirrors `handleStop`.
 *
 * Seek and volume are deliberately looser here than their slash equivalents (`/stream seek` is
 * requester-or-admin): pressing a button while sitting in the channel is a different, much more
 * visible act than typing a command from anywhere in the server. The slash gates are unchanged.
 */
import {
  LoopModeSchema,
  type LoopMode,
  type PlaybackEvent,
} from "@shepherdjerred/streambot/machine/types.ts";
import {
  canControlItem,
  isAdmin,
} from "@shepherdjerred/streambot/discord/permissions.ts";
import { formatTimecode } from "@shepherdjerred/streambot/discord/timecode.ts";
import type { PlaybackView } from "@shepherdjerred/streambot/discord/queue-text.ts";
import type { UserId } from "@shepherdjerred/streambot/types/ids.ts";

/** Namespace prefix for every player-card component id, versioned so a format change is detectable. */
export const CONTROL_ID_PREFIX = "sb:v1:";

/** Seconds a single ⏪/⏩ press moves playback. */
export const SEEK_STEP_SECONDS = 30;
/** Percentage points a single 🔉/🔊 press moves the volume. */
export const VOLUME_STEP_PERCENT = 10;
/** Volume bounds, matching `/stream volume`'s 0-200 option range in `commands.ts`. */
export const VOLUME_MIN_PERCENT = 0;
export const VOLUME_MAX_PERCENT = 200;

export const ControlAction = {
  Back: "back",
  Forward: "forward",
  Skip: "skip",
  Stop: "stop",
  Loop: "loop",
  VolumeDown: "voldown",
  VolumeUp: "volup",
  Shuffle: "shuffle",
  Queue: "queue",
  Subtitles: "subs",
  Chapter: "chapter",
} as const;

export type ControlAction = (typeof ControlAction)[keyof typeof ControlAction];

/** `sb:v1:<action>` — the component id Discord echoes back on a click. */
export function encodeControlId(action: ControlAction): string {
  return `${CONTROL_ID_PREFIX}${action}`;
}

/**
 * Inverse of {@link encodeControlId}. Returns null for anything outside our namespace — the global
 * interaction router uses this to ignore `pagination.ts`'s `page_*` ids and the subtitle picker's
 * own id, which are driven by their own message-scoped collectors.
 */
export function decodeControlId(customId: string): ControlAction | null {
  if (!customId.startsWith(CONTROL_ID_PREFIX)) {
    return null;
  }
  const action = customId.slice(CONTROL_ID_PREFIX.length);
  // Narrowed by comparison rather than cast — an unrecognized suffix yields null, not a lie.
  for (const value of Object.values(ControlAction)) {
    if (value === action) {
      return value;
    }
  }
  return null;
}

/** `off → track → queue → off`, so one button cycles every loop mode. */
export function nextLoopMode(current: string): LoopMode {
  const parsed = LoopModeSchema.safeParse(current);
  switch (parsed.success ? parsed.data : "off") {
    case "off":
      return "track";
    case "track":
      return "queue";
    case "queue":
      return "off";
  }
}

/**
 * What a click should do. `ack` is the ephemeral confirmation shown to the presser once the effect
 * has been applied; the card itself re-renders separately so everyone sees the new state.
 */
export type ControlOutcome =
  | {
      readonly kind: "dispatch";
      readonly event: PlaybackEvent;
      readonly ack: string;
    }
  | { readonly kind: "seek"; readonly seconds: number; readonly ack: string }
  | { readonly kind: "volume"; readonly percent: number; readonly ack: string }
  /** Answer with a read-only ephemeral message; nothing is mutated. */
  | { readonly kind: "ephemeral"; readonly text: string }
  /** Open the `/stream subtitles` track picker on this interaction. */
  | { readonly kind: "subtitle-picker" }
  | { readonly kind: "denied"; readonly message: string };

export type ControlRequest = {
  readonly action: ControlAction;
  /** Current session state, used both for permission checks and to compute relative targets. */
  readonly view: PlaybackView;
  readonly userId: UserId;
  readonly adminIds: readonly UserId[];
  /** True when the presser is currently sitting in this session's voice channel. */
  readonly inVoiceChannel: boolean;
  /** 1-based chapter number for {@link ControlAction.Chapter}; ignored for every other action. */
  readonly chapterNumber?: number | undefined;
};

/**
 * Resolve a click into an outcome. Every branch returns something — a denial is an outcome, not an
 * exception — so the caller always has an ephemeral reply to send and a click never silently fails
 * (which Discord surfaces as "Interaction Failed").
 */
export function resolveControlAction(request: ControlRequest): ControlOutcome {
  const { action, view, userId, adminIds } = request;

  if (!request.inVoiceChannel) {
    return {
      kind: "denied",
      message: "Join the voice channel to use these controls.",
    };
  }

  switch (action) {
    case ControlAction.Queue:
      return { kind: "ephemeral", text: queueSummary(view) };
    case ControlAction.Stop:
      return isAdmin(userId, adminIds)
        ? {
            kind: "dispatch",
            event: { type: "STOP" },
            ack: "⏹️ Stopped and cleared the queue.",
          }
        : { kind: "denied", message: "Only an admin can stop playback." };
    case ControlAction.Skip:
      return canControlItem(userId, view.current?.requesterId ?? null, adminIds)
        ? { kind: "dispatch", event: { type: "SKIP" }, ack: "⏭️ Skipped." }
        : {
            kind: "denied",
            message: "Only the requester or an admin can skip this.",
          };
    case ControlAction.Subtitles:
      return canControlItem(userId, view.current?.requesterId ?? null, adminIds)
        ? { kind: "subtitle-picker" }
        : {
            kind: "denied",
            message:
              "Only the requester or an admin can change subtitles for this.",
          };
    case ControlAction.Loop: {
      const mode = nextLoopMode(view.loop);
      return {
        kind: "dispatch",
        event: { type: "SET_LOOP", mode },
        ack: `🔁 Loop: **${mode}**.`,
      };
    }
    case ControlAction.Shuffle:
      return {
        kind: "dispatch",
        event: { type: "SHUFFLE" },
        ack: `🔀 Shuffled ${String(view.queue.length)} item(s).`,
      };
    case ControlAction.VolumeUp:
      return volumeOutcome(view.volume + VOLUME_STEP_PERCENT);
    case ControlAction.VolumeDown:
      return volumeOutcome(view.volume - VOLUME_STEP_PERCENT);
    case ControlAction.Back:
      return relativeSeek(view, -SEEK_STEP_SECONDS);
    case ControlAction.Forward:
      return relativeSeek(view, SEEK_STEP_SECONDS);
    case ControlAction.Chapter:
      return chapterSeek(view, request.chapterNumber);
  }
}

function volumeOutcome(target: number): ControlOutcome {
  const percent = Math.min(
    VOLUME_MAX_PERCENT,
    Math.max(VOLUME_MIN_PERCENT, target),
  );
  return { kind: "volume", percent, ack: `🔊 Volume → ${String(percent)}%.` };
}

/**
 * Relative seek from the live position. Clamped at 0 so ⏪ near the start rewinds to the beginning
 * instead of asking ffmpeg for a negative offset, and clamped just short of the duration (when
 * known) so ⏩ near the end doesn't seek past EOF and trip the streamer's short-read detection.
 */
function relativeSeek(
  view: PlaybackView,
  deltaSeconds: number,
): ControlOutcome {
  if (view.current === null || view.positionSeconds === null) {
    return { kind: "denied", message: "Nothing is playing." };
  }
  const duration = view.current.durationSeconds;
  const upperBound =
    duration === null || duration <= 0 ? null : Math.max(0, duration - 5);
  const raw = view.positionSeconds + deltaSeconds;
  const target = Math.max(
    0,
    upperBound === null ? raw : Math.min(raw, upperBound),
  );
  return {
    kind: "seek",
    seconds: target,
    ack: `${deltaSeconds < 0 ? "⏪" : "⏩"} Seeked to ${formatTimecode(target)}.`,
  };
}

function chapterSeek(
  view: PlaybackView,
  chapterNumber: number | undefined,
): ControlOutcome {
  const current = view.current;
  if (current === null) {
    return { kind: "denied", message: "Nothing is playing." };
  }
  if (chapterNumber === undefined) {
    return { kind: "denied", message: "No chapter was selected." };
  }
  const chapter = current.chapters[chapterNumber - 1];
  if (chapter === undefined) {
    return {
      kind: "denied",
      message:
        current.chapters.length === 0
          ? "No chapters for the current video."
          : `There's no chapter ${String(chapterNumber)}. This video has ${String(current.chapters.length)}.`,
    };
  }
  return {
    kind: "seek",
    seconds: chapter.startSeconds,
    ack: `⏩ Chapter ${String(chapter.index)}: **${chapter.title}** (${formatTimecode(chapter.startSeconds)}).`,
  };
}

/** How many queue entries the 📜 button's ephemeral summary lists before truncating. */
const QUEUE_PREVIEW_LIMIT = 10;

function queueSummary(view: PlaybackView): string {
  const lines: string[] = [];
  if (view.current !== null) {
    lines.push(`**Now:** ${view.current.title}`);
  }
  view.queue.slice(0, QUEUE_PREVIEW_LIMIT).forEach((item, index) => {
    lines.push(`${String(index + 1)}. ${item.title} (<@${item.requesterId}>)`);
  });
  if (view.queue.length > QUEUE_PREVIEW_LIMIT) {
    lines.push(
      `…and ${String(view.queue.length - QUEUE_PREVIEW_LIMIT)} more — run \`/stream queue\` for the full list.`,
    );
  }
  return lines.length === 0 ? "The queue is empty." : lines.join("\n");
}
