import type { ResolvedSource } from "@shepherdjerred/streambot/machine/types.ts";
import type { MediaMode } from "@shepherdjerred/streambot/sources/media-kind.ts";
import type {
  Source,
  SubtitlePref,
} from "@shepherdjerred/streambot/sources/source.ts";
import type { UserId } from "@shepherdjerred/streambot/types/ids.ts";
import type { MediaIntent } from "@shepherdjerred/streambot/discovery/media-intent.ts";
import type {
  DiscoveryScope,
  MediaCandidate,
} from "@shepherdjerred/streambot/discovery/candidate.ts";
import type { SportsProvider } from "@shepherdjerred/streambot/sports/types.ts";
import { isHttpUrl } from "@shepherdjerred/streambot/discord/resolve.ts";
import { PlaybackCommandBoundaryError } from "./playback-command-errors.ts";
export type VoicePlaySource = "auto" | "history" | "local" | "youtube";
export type VoicePlayPlacement = "queue" | "next" | "now";

export type PlayInput = {
  readonly query: string;
  readonly source: VoicePlaySource;
  readonly placement: VoicePlayPlacement;
  readonly userId: UserId;
  readonly sourceOverride?: Source;
  readonly signal?: AbortSignal;
  /** Slash commands may still supply supported URLs; spoken commands never may. */
  readonly spoken?: boolean;
  /** Full spoken command after the wake prefix, used to honour “watch” over a model `mode: video`. */
  readonly utterance?: string;
  readonly subtitles?: SubtitlePref;
  /** Per-request transport override; `undefined` and `"auto"` both mean "let the classifier decide". */
  readonly mode?: MediaMode;
  readonly provider?: SportsProvider | "auto";
};

export type SelectedMedia = {
  readonly source: Source;
  readonly candidate?: MediaCandidate;
  readonly sports: boolean;
  readonly preResolved?: ResolvedSource;
};

export type ResolvePlayableInput = {
  readonly source: Source;
  readonly preResolved?: ResolvedSource;
  readonly play: PlayInput;
  readonly query: string;
  readonly intent: MediaIntent;
  readonly scope: DiscoveryScope | null;
};

export function normalizeVoicePlayQuery(query: string): string {
  const normalized = query.trim();
  if (normalized.length === 0)
    throw new PlaybackCommandBoundaryError("Say what you want me to play.");
  if (isHttpUrl(normalized)) {
    throw new PlaybackCommandBoundaryError("Say a title instead of a URL.");
  }
  return normalized;
}
