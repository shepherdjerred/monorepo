/**
 * Pure text builders for the discovery commands (`/stream help`, `/stream sources`, `/stream
 * list`/`search`). Kept out of `command-handler.ts` so they carry no playback state and can be
 * unit-tested directly (a command-handler test asserts every registered subcommand appears in
 * {@link helpText}).
 */
import type { LibraryEntry } from "@shepherdjerred/streambot/sources/library.ts";
import { searchLibrary } from "@shepherdjerred/streambot/sources/library.ts";

/** Source names per page of `/stream sources` output (browse + filtered). */
const SOURCES_PER_PAGE = 30;

/** Library entries per page of `/stream list`/`search` output. */
const LIST_PER_PAGE = 20;

/**
 * The result of {@link sourcesPages}/{@link listPages}: a header line describing the full result
 * set, and one Discord-message-sized body chunk per page. The adapter renders Prev/Next/First/Last
 * buttons when `pages.length > 1`; when it's 1 it just sends the single message.
 */
export type PaginatedPages = {
  readonly header: string;
  readonly pages: readonly string[];
};

/**
 * The `/stream help` reference: a grouped command list plus a "Supported sources" note. It has no
 * playback state, but only advertises voice commands when the validated feature flag is enabled.
 * Must stay under Discord's 2000-char message limit.
 */
export function helpText(voiceEnabled: boolean): string {
  return [
    "🎬 **Streambot** — `/stream` commands",
    "",
    "**Playback**",
    "• `/stream play <query>` · `playnext <query>` · `join` · `skip` · `seek <time>`",
    "• `/stream stop` — stop and clear _(admin)_",
    "",
    ...(voiceEnabled
      ? [
          "**Voice commands**",
          "• Say **Hey Streambot**, then play/search/control naturally. Follow-up choices from the same speaker do not need the wake phrase.",
          "• Wake detection stays local; only that speaker's command is sent. Say “local” or “YouTube” to force a source.",
          "",
        ]
      : []),
    "**Diagnostics**",
    "• `/stream voice-debug start|stop|status` _(admin)_",
    "",
    "**Queue**",
    "• `/stream queue` · `nowplaying` · `remove` · `move` · `shuffle` · `loop` · `volume`",
    "• `/stream clear` _(admin)_",
    "• `/stream playback pause|resume|restart|previous|leave`",
    "• `/stream history list|replay` · `/stream personal favorites|usual|continue`",
    "• Personal queues: `favorite-add`, `favorite-remove`, `save-queue`, `saved-queues`, `load-queue`, `delete-queue`",
    "",
    "**Discovery**",
    "• `/stream list` · `search` · `sources` · `chapters` · `chapter` · `subtitles`",
    "",
    "**Player card** — pause, restart, seek, skip, volume, shuffle, queue, subtitles, stop, loop, and chapters are available as controls.",
    "",
    "📡 **Supported sources**",
    "Search defaults to history + local files + YouTube. Direct links and playlists use yt-dlp; DRM and login-only sites are unsupported.",
    "",
    "• `/stream help` — show this message",
  ].join("\n");
}

/**
 * Render `/stream sources` as a paginated, browseable list. Bare call paginates all sources;
 * a `query` paginates only the case-insensitive substring matches. When nothing matches, returns
 * a single page with an explanatory line and no entries. The adapter wires Prev/Next buttons
 * on top when `pages.length > 1`.
 */
export function sourcesPages(
  sources: readonly string[],
  query: string | null,
): PaginatedPages {
  const trimmed = query?.trim() ?? "";
  const isFiltered = trimmed.length > 0;
  const matched = isFiltered
    ? sources.filter((name) =>
        name.toLowerCase().includes(trimmed.toLowerCase()),
      )
    : sources;

  if (isFiltered && matched.length === 0) {
    return {
      header: `📡 No sources matching \`${trimmed}\``,
      pages: [
        "You can still try `/stream play <url>` with a direct link — any public link yt-dlp can fetch without a login should work.",
      ],
    };
  }

  const pages = paginate(matched, SOURCES_PER_PAGE);
  const header = isFiltered
    ? `📡 **${String(matched.length)} source(s) matching \`${trimmed}\`**`
    : `📡 **yt-dlp supports ${String(matched.length)} sources** — any public link it can fetch without a login. Popular: YouTube · Twitch · Vimeo · SoundCloud · Reddit · Bandcamp · archive.org · direct \`.mp4\`/HLS.`;

  return { header, pages };
}

function paginate(
  names: readonly string[],
  perPage: number,
): readonly string[] {
  if (names.length === 0) {
    return ["_(no sources)_"];
  }
  const pages: string[] = [];
  for (let i = 0; i < names.length; i += perPage) {
    const slice = names.slice(i, i + perPage).map((name) => `\`${name}\``);
    pages.push(slice.join(" · "));
  }
  return pages;
}

/**
 * Render `/stream list`/`search` as a paginated, browseable list of library entries. Bare call
 * (`query === null`) paginates the whole library; a query paginates only the fuzzy matches
 * ({@link searchLibrary}: exact > prefix > substring), unranked-limited (the caller wants every
 * match spread across pages, not just the top N). The adapter wires Prev/Next buttons on top when
 * `pages.length > 1`.
 */
export function listPages(
  entries: readonly LibraryEntry[],
  query: string | null,
): PaginatedPages {
  const trimmed = query?.trim() ?? "";
  const isFiltered = trimmed.length > 0;
  const matched = isFiltered
    ? searchLibrary(entries, trimmed, entries.length)
    : entries;

  if (matched.length === 0) {
    return {
      header: isFiltered
        ? `No matches for \`${trimmed}\`.`
        : "The library is empty.",
      pages: [""],
    };
  }

  const lines = matched.map(
    (entry, index) =>
      `${String(index + 1)}. \`${entry.title}\` _(${entry.library})_`,
  );
  const header = isFiltered
    ? `**${String(matched.length)} result(s) matching \`${trimmed}\`:**`
    : `**${String(matched.length)} result(s):**`;
  return { header, pages: paginateLines(lines, LIST_PER_PAGE) };
}

function paginateLines(
  lines: readonly string[],
  perPage: number,
): readonly string[] {
  const pages: string[] = [];
  for (let i = 0; i < lines.length; i += perPage) {
    pages.push(lines.slice(i, i + perPage).join("\n"));
  }
  return pages;
}
