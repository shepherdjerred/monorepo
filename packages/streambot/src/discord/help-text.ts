/**
 * Pure text builders for the discovery commands (`/stream help`, `/stream sources`). Kept out of
 * `command-handler.ts` so they carry no playback state and can be unit-tested directly (a
 * command-handler test asserts every registered subcommand appears in {@link helpText}).
 */

/** Source names per page of `/stream sources` output (browse + filtered). */
const SOURCES_PER_PAGE = 30;

/**
 * The result of {@link sourcesPages}: a header line describing the full result set, and one
 * Discord-message-sized body chunk per page. The adapter renders Prev/Next/First/Last buttons
 * when `pages.length > 1`; when it's 1 it just sends the single message.
 */
export type SourcesPages = {
  readonly header: string;
  readonly pages: readonly string[];
};

/**
 * The `/stream help` reference: a grouped command list plus a "Supported sources" note. Static (no
 * playback state). Must stay under Discord's 2000-char message limit.
 */
export function helpText(): string {
  return [
    "🎬 **Streambot** — `/stream` commands",
    "",
    "**Playback**",
    "• `/stream play <query>` — queue a video (library title, URL, playlist, or search)",
    "• `/stream playnext <query>` — queue it to the front",
    "• `/stream skip` — skip the current video",
    "• `/stream stop` — stop & clear the queue _(admin)_",
    "• `/stream seek <pos>` — jump to a timestamp (`90`, `1:30`, `1:02:03`)",
    "",
    "**Queue**",
    "• `/stream queue` · `nowplaying` · `remove <index>` · `move <from> <to>`",
    "• `/stream clear` _(admin)_ · `shuffle` · `loop <off|track|queue>` · `volume <0-200>`",
    "",
    "**Library & chapters**",
    "• `/stream list [filter]` · `search <query>` · `chapters` · `chapter <n>`",
    "",
    "**Subtitles** — add `subtitles:on|off` and `sublang:<lang>` (e.g. `en`, `en.forced`) to `play`/`playnext`.",
    "",
    "📡 **Supported sources**",
    "`/stream play` accepts a library title, search terms, or any public link yt-dlp can fetch " +
      "without logging in — YouTube, Twitch, Vimeo, SoundCloud, Reddit, direct `.mp4`/HLS, and most " +
      "public video sites. Playlist links expand automatically. Subscription/DRM (Netflix, Disney+…) " +
      "and login-only sites won't work.",
    "Browse or search the full list with `/stream sources [query]` (e.g. `/stream sources twitch`).",
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
): SourcesPages {
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
