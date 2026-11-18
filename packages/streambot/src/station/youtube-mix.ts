import { z } from "zod";
import { canonicalWorkKey } from "@shepherdjerred/streambot/discovery/same-work.ts";
import {
  isBlockedText,
  isBlockedUrl,
} from "@shepherdjerred/streambot/moderation/adult-block.ts";
import {
  sourceIdentity,
  type Source,
} from "@shepherdjerred/streambot/sources/source.ts";
import { runSubprocess } from "@shepherdjerred/streambot/sources/subprocess.ts";

const VIDEO_ID_RE = /^[\w-]{11}$/u;
const NON_SONG_TITLE_RE =
  /\b(?:full album|1 hour|2 hours|3 hours|10 hours|live stream|24\/7)\b/iu;
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
]);

export type YoutubeMixItem = {
  readonly url: string;
  readonly title: string;
  readonly videoId: string | null;
  readonly source: Source;
};

/** Extract an 11-character YouTube video ID from `youtube.com/watch?v=` or `youtu.be/` URLs. */
export function extractYoutubeVideoId(value: string): string | null {
  try {
    const parsed = new URL(value.trim());
    const host = parsed.hostname.toLowerCase();
    if (host === "youtu.be") {
      const id = parsed.pathname.slice(1).split("/")[0] ?? "";
      return VIDEO_ID_RE.test(id) ? id : null;
    }
    if (YOUTUBE_HOSTS.has(host)) {
      const id = parsed.searchParams.get("v") ?? "";
      return VIDEO_ID_RE.test(id) ? id : null;
    }
    return null;
  } catch {
    return null;
  }
}

export function buildYoutubeMixArgs(videoId: string, limit = 15): string[] {
  if (!VIDEO_ID_RE.test(videoId)) {
    throw new Error("Invalid YouTube video ID for Mix expansion");
  }
  const boundedLimit = Math.min(30, Math.max(1, Math.trunc(limit)));
  return [
    "--ignore-config",
    "--flat-playlist",
    "--no-warnings",
    "--playlist-end",
    String(boundedLimit),
    "--print",
    "%(url)s\t%(title)s",
    `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`,
  ];
}

function normalizeMixUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (VIDEO_ID_RE.test(trimmed)) {
    return `https://www.youtube.com/watch?v=${trimmed}`;
  }
  const parsed = z.url().safeParse(trimmed);
  if (!parsed.success) return null;
  const videoId = extractYoutubeVideoId(parsed.data);
  return videoId === null
    ? parsed.data
    : `https://www.youtube.com/watch?v=${videoId}`;
}

async function fetchMixOutput(
  command: readonly string[],
  signal: AbortSignal,
  run: typeof runSubprocess,
): Promise<string | null> {
  const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
  try {
    const result = await run([...command], boundedSignal);
    return result.exitCode !== 0 && result.stdout.trim() === ""
      ? null
      : result.stdout;
  } catch {
    return null;
  }
}

function parseMixLine(
  line: string,
  state: {
    readonly excluded: ReadonlySet<string>;
    readonly seenIds: Set<string>;
    readonly seenWorks: Set<string>;
  },
): YoutubeMixItem | null {
  const tab = line.indexOf("\t");
  if (tab <= 0) return null;
  const url = normalizeMixUrl(line.slice(0, tab));
  const title = line.slice(tab + 1).trim();
  if (
    url === null ||
    title === "" ||
    title === "NA" ||
    isBlockedUrl(url) ||
    isBlockedText(title) ||
    NON_SONG_TITLE_RE.test(title)
  ) {
    return null;
  }
  const itemVideoId = extractYoutubeVideoId(url);
  if (itemVideoId !== null && state.seenIds.has(itemVideoId)) return null;
  const source: Source = { kind: "url", url, title, mode: "music" };
  if (state.excluded.has(sourceIdentity(source))) return null;

  const workKey = canonicalWorkKey(title);
  if (workKey !== "" && state.seenWorks.has(workKey)) return null;
  if (itemVideoId !== null) state.seenIds.add(itemVideoId);
  if (workKey !== "") state.seenWorks.add(workKey);

  return { url, title, videoId: itemVideoId, source };
}

export async function expandYoutubeMix(input: {
  readonly ytDlpPath: string;
  readonly videoId: string;
  readonly limit?: number;
  readonly excludeIdentities?: ReadonlySet<string>;
  readonly signal: AbortSignal;
  readonly run?: typeof runSubprocess;
}): Promise<YoutubeMixItem[]> {
  if (!VIDEO_ID_RE.test(input.videoId)) return [];
  const args = buildYoutubeMixArgs(input.videoId, input.limit ?? 15);
  const stdout = await fetchMixOutput(
    [input.ytDlpPath, ...args],
    input.signal,
    input.run ?? runSubprocess,
  );
  if (stdout === null) return [];

  const state = {
    excluded: input.excludeIdentities ?? new Set<string>(),
    seenIds: new Set<string>([input.videoId]),
    seenWorks: new Set<string>(),
  };
  const items: YoutubeMixItem[] = [];
  for (const line of stdout.split("\n")) {
    const parsed = parseMixLine(line, state);
    if (parsed !== null) items.push(parsed);
  }
  return items;
}
