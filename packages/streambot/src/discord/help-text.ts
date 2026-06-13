/**
 * Pure text builders for the discovery commands (`/stream help`, `/stream sources`). Kept out of
 * `command-handler.ts` so they carry no playback state and can be unit-tested directly (a
 * command-handler test asserts every registered subcommand appears in {@link helpText}).
 */

/** Max source names shown for a `/stream sources <query>` result before truncating. */
const MAX_SOURCES = 20;

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
 * Render `/stream sources`: a count + popular highlights when called bare, or up to
 * {@link MAX_SOURCES} filtered matches when given a query.
 */
export function sourcesText(
  sources: readonly string[],
  query: string | null,
): string {
  const trimmed = query?.trim() ?? "";
  if (trimmed.length === 0) {
    return [
      `📡 **yt-dlp supports ${String(sources.length)} sources** — any public link it can fetch without a login.`,
      "Popular: YouTube · Twitch · Vimeo · SoundCloud · Reddit · Bandcamp · archive.org · direct `.mp4`/HLS.",
      "Search the full list with `/stream sources <query>` — e.g. `/stream sources twitch`.",
    ].join("\n");
  }
  const needle = trimmed.toLowerCase();
  const matched = sources.filter((name) => name.toLowerCase().includes(needle));
  if (matched.length === 0) {
    return `No sources matching \`${trimmed}\`. You can still try \`/stream play <url>\` with a direct link.`;
  }
  const shown = matched.slice(0, MAX_SOURCES).map((name) => `\`${name}\``);
  const suffix =
    matched.length > MAX_SOURCES
      ? `\n…and ${String(matched.length - MAX_SOURCES)} more`
      : "";
  return `**${String(matched.length)} source(s) matching \`${trimmed}\`:**\n${shown.join(" · ")}${suffix}`;
}
