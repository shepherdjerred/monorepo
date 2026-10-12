/**
 * A rotating pool of usage tips surfaced as a footer on `/stream play`/`playnext` replies.
 * Separate from `help-text.ts`, which is scoped to static reference text under a 2000-char
 * message-size budget — this pool is unbounded and grows freely without touching that budget.
 */

export const TIPS: readonly string[] = [
  "Jump to a timestamp with `/stream seek 1:30` (also accepts `90` or `1:02:03`).",
  "See a video's chapter markers with `/stream playback chapters`, then jump to one with `/stream chapter <n>`.",
  "`/stream list [filter]` browses your library; `/stream search <query>` does the same fuzzy match.",
  "`/stream playnext <query>` jumps a video to the front of the queue instead of the back.",
  "Turn subtitles on/off or set a language with `subtitles:on|off` and `sublang:<lang>` on `play`/`playnext`.",
  "Already playing something? Run `/stream subtitles` to pick from the actual available tracks.",
  "Not sure a site is supported? `/stream sources [query]` browses everything yt-dlp can fetch.",
  "`/stream move <from> <to>` reorders the queue without removing and re-adding anything.",
  "`/stream remove <index>` pulls a specific item out of the queue.",
  "`/stream shuffle` randomizes the rest of the queue.",
  "`/stream loop <off|track|queue>` repeats the current video or cycles the whole queue.",
  "`/stream nowplaying` shows the current title, position, and requester.",
  "`/stream volume <0-200>` adjusts playback volume live, above or below 100%.",
  "Playlist links (YouTube, etc.) expand automatically when you `/stream play` them.",
  "Only the requester or an admin can `/stream skip`, `/stream seek`, or `/stream remove` an item.",
];

/** Pick one tip at random for a play/playnext reply footer. */
export function randomTip(playbackChannel?: number, webUrl?: string): string {
  const tips = [
    ...TIPS,
    ...(playbackChannel === undefined
      ? []
      : [
          "Channel 1 is mic audio; select channel 2 or higher for Go Live video. Channels 1 and 2 share one userbot.",
          "Use `/stream channels` to see playback in your current voice channel. Controls target your personal selection.",
          "Select channel 3 or higher for another video. Only channel 1 writes to the mic.",
        ]),
    ...(webUrl === undefined
      ? []
      : [
          `Browse Plex, live sports, and recent plays in the web remote: ${webUrl}`,
        ]),
  ];
  const index = Math.floor(Math.random() * tips.length);
  const tip = tips[index];
  if (tip === undefined) {
    throw new Error("TIPS pool is empty");
  }
  return tip;
}
