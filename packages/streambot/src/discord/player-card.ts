/**
 * Pure rendering for the player card — the live now-playing message with a progress bar and
 * control rows. Emits neutral descriptors rather than discord.js builders (the same split
 * `buildMenuOptions` uses in `subtitle-menu.ts`), so the layout, the bar math, and every
 * enabled/disabled edge are unit-testable without a gateway. `player-card-message.ts` turns these
 * descriptors into an embed and action rows; `player-card-manager.ts` owns the lifecycle.
 *
 * With the card disabled (`PLAYER_CARD_ENABLED=false`) this renders the original one-shot
 * `▶️ Now playing …` announcement with no components, so both modes run through one code path.
 */
import { findChapterAt } from "@shepherdjerred/streambot/sources/chapters.ts";
import { formatTimecode } from "@shepherdjerred/streambot/discord/timecode.ts";
import {
  ControlAction,
  VOLUME_MAX_PERCENT,
  VOLUME_MIN_PERCENT,
  encodeControlId,
} from "@shepherdjerred/streambot/discord/player-controls.ts";
import type { PlaybackView } from "@shepherdjerred/streambot/discord/queue-text.ts";

/** Cells in the progress bar (one knob plus the track around it). */
const PROGRESS_BAR_CELLS = 24;
/** Discord's hard cap on select-menu options, shared with the subtitle picker. */
const MAX_CHAPTER_OPTIONS = 25;

export type ButtonStyleName = "primary" | "secondary" | "danger" | "success";

export type ButtonSpec = {
  readonly id: string;
  readonly label: string;
  readonly style: ButtonStyleName;
  readonly disabled: boolean;
};

export type SelectOptionSpec = {
  readonly label: string;
  readonly value: string;
  readonly description: string;
};

export type SelectSpec = {
  readonly id: string;
  readonly placeholder: string;
  readonly options: readonly SelectOptionSpec[];
};

export type PlayerCardEmbed = {
  readonly title: string;
  readonly description: string | null;
  /** Large image — used only by the plain (card-disabled) announcement, matching the old embed. */
  readonly imageUrl: string | null;
  /** Right-side thumbnail, so the progress bar and metadata line stay readable beside the poster. */
  readonly thumbnailUrl: string | null;
};

export type PlayerCardPayload = {
  readonly content: string;
  readonly embed: PlayerCardEmbed | null;
  readonly rows: readonly (readonly ButtonSpec[])[];
  readonly select: SelectSpec | null;
};

export type PlayerCardInput = {
  readonly view: PlaybackView;
  /** TMDB poster for the current item, when one was found. */
  readonly posterUrl: string | null;
  /** Master switch; false renders the legacy plain-text announcement. */
  readonly enabled: boolean;
  /** True once the session has ended — renders a final, control-less card. */
  readonly finished: boolean;
};

/**
 * A `━━━●───` bar for `position / duration`. Returns null when the duration is unknown (live
 * streams, a failed ffprobe) or non-positive, in which case the caller shows elapsed time alone
 * rather than a bar that would imply a length we don't know.
 */
export function renderProgressBar(
  positionSeconds: number | null,
  durationSeconds: number | null,
): string | null {
  if (
    positionSeconds === null ||
    durationSeconds === null ||
    durationSeconds <= 0
  ) {
    return null;
  }
  const ratio = Math.min(1, Math.max(0, positionSeconds / durationSeconds));
  const lastCell = PROGRESS_BAR_CELLS - 1;
  const knob = Math.round(ratio * lastCell);
  return `${"━".repeat(knob)}●${"─".repeat(lastCell - knob)}`;
}

/** `1:04:12 / 2:16:00`, or just `1:04:12` when the duration is unknown. */
function renderTimecodes(
  positionSeconds: number | null,
  durationSeconds: number | null,
): string | null {
  if (positionSeconds === null) {
    return null;
  }
  const elapsed = formatTimecode(positionSeconds);
  return durationSeconds === null || durationSeconds <= 0
    ? elapsed
    : `${elapsed} / ${formatTimecode(durationSeconds)}`;
}

/**
 * A short line naming what the session is doing when it is *not* streaming, so a card that appears
 * before the first frame (joining, resolving) doesn't look stalled. Null while streaming — the bar
 * already says everything.
 */
function renderStatusLine(state: string, finished: boolean): string | null {
  if (finished) {
    return "⏹️ Stopped.";
  }
  switch (state) {
    case "streaming":
      return null;
    case "joining":
      return "🔗 Joining the voice channel…";
    case "resolving":
      return "⏳ Preparing the video…";
    case "waiting":
      return "💤 Waiting for the next video…";
    case "leaving":
      return "👋 Leaving the voice channel…";
    case "failed":
      return "⚠️ Playback failed — retrying.";
    default:
      return null;
  }
}

/** `Requested by @x · 🔁 queue · 🔊 100% · 3 in queue` */
function renderMetaLine(view: PlaybackView): string {
  const parts: string[] = [];
  if (view.current !== null) {
    parts.push(`Requested by <@${view.current.requesterId}>`);
  }
  parts.push(`🔁 ${view.loop}`);
  parts.push(`🔊 ${String(view.volume)}%`);
  if (view.queue.length > 0) {
    parts.push(`${String(view.queue.length)} in queue`);
  }
  return parts.join(" · ");
}

function renderDescription(input: PlayerCardInput): string {
  const { view } = input;
  const lines: string[] = [];
  const status = renderStatusLine(view.state, input.finished);
  if (status !== null) {
    lines.push(status);
  }

  const duration = view.current?.durationSeconds ?? null;
  const bar = renderProgressBar(view.positionSeconds, duration);
  const timecodes = renderTimecodes(view.positionSeconds, duration);
  if (timecodes !== null) {
    lines.push(bar === null ? `\`${timecodes}\`` : `${bar}  \`${timecodes}\``);
  }

  if (view.current !== null && view.positionSeconds !== null) {
    const chapter = findChapterAt(view.current.chapters, view.positionSeconds);
    if (chapter !== null) {
      lines.push(`📖 Chapter ${String(chapter.index)}: ${chapter.title}`);
    }
  }

  lines.push(renderMetaLine(view));
  return lines.join("\n");
}

function button(
  action: ControlAction,
  label: string,
  style: ButtonStyleName,
  disabled: boolean,
): ButtonSpec {
  return { id: encodeControlId(action), label, style, disabled };
}

/**
 * The two control rows. Everything that acts on the *current item* is disabled when nothing is
 * playing, so a card sitting in `waiting` doesn't offer buttons that could only answer "Nothing is
 * playing." Volume buttons disable at the 0/200 bounds.
 */
function buildRows(view: PlaybackView): readonly (readonly ButtonSpec[])[] {
  const noItem = view.current === null;
  const noPosition = view.positionSeconds === null;
  const seekDisabled = noItem || noPosition;
  return [
    [
      button(ControlAction.Back, "⏪ 30s", "secondary", seekDisabled),
      button(ControlAction.Forward, "⏩ 30s", "secondary", seekDisabled),
      button(ControlAction.Skip, "⏭ Skip", "primary", noItem),
      button(ControlAction.Stop, "⏹ Stop", "danger", false),
      button(ControlAction.Loop, `🔁 Loop: ${view.loop}`, "secondary", false),
    ],
    [
      button(
        ControlAction.VolumeDown,
        "🔉",
        "secondary",
        view.volume <= VOLUME_MIN_PERCENT,
      ),
      button(
        ControlAction.VolumeUp,
        "🔊",
        "secondary",
        view.volume >= VOLUME_MAX_PERCENT,
      ),
      button(
        ControlAction.Shuffle,
        "🔀 Shuffle",
        "secondary",
        view.queue.length < 2,
      ),
      button(ControlAction.Queue, "📜 Queue", "secondary", false),
      button(ControlAction.Subtitles, "💬 Subtitles", "secondary", noItem),
    ],
  ];
}

/**
 * Chapter jump menu, rendered only when the current item actually has chapters. Truncated to
 * Discord's 25-option cap — the placeholder says so, and `/stream chapters` still lists them all.
 */
function buildChapterSelect(view: PlaybackView): SelectSpec | null {
  const chapters = view.current?.chapters ?? [];
  if (chapters.length === 0) {
    return null;
  }
  const shown = chapters.slice(0, MAX_CHAPTER_OPTIONS);
  return {
    id: encodeControlId(ControlAction.Chapter),
    placeholder:
      chapters.length > shown.length
        ? `Jump to a chapter (first ${String(shown.length)} of ${String(chapters.length)})`
        : "Jump to a chapter",
    options: shown.map((chapter) => ({
      label: `${String(chapter.index)}. ${chapter.title}`.slice(0, 100),
      value: String(chapter.index),
      description: formatTimecode(chapter.startSeconds),
    })),
  };
}

/** The legacy one-shot announcement, used when the card is disabled by config. */
function renderPlainAnnouncement(input: PlayerCardInput): PlayerCardPayload {
  const current = input.view.current;
  const title = current?.title ?? "Unknown";
  const who =
    current === null ? "" : ` (requested by <@${current.requesterId}>)`;
  return {
    content: `▶️ Now playing **${title}**${who}`,
    embed:
      input.posterUrl === null
        ? null
        : {
            title,
            description: null,
            imageUrl: input.posterUrl,
            thumbnailUrl: null,
          },
    rows: [],
    select: null,
  };
}

/** Render the card (or the plain announcement) for the current view. */
export function renderPlayerCard(input: PlayerCardInput): PlayerCardPayload {
  if (!input.enabled) {
    return renderPlainAnnouncement(input);
  }
  const { view } = input;
  const title = view.current?.title ?? "Nothing playing";
  return {
    content: "",
    embed: {
      title: input.finished ? title : `▶️ ${title}`,
      description: renderDescription(input),
      imageUrl: null,
      thumbnailUrl: input.posterUrl,
    },
    // A finished session keeps its card as readable history, but every control is removed rather
    // than left dangling on a session that no longer exists.
    rows: input.finished ? [] : buildRows(view),
    select: input.finished ? null : buildChapterSelect(view),
  };
}
