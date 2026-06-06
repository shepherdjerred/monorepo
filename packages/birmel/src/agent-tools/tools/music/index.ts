import { playbackTools } from "./playback.ts";
import { queueTools } from "./queue.ts";
import { playlistTools } from "./playlists.ts";

export const allMusicTools = [
  ...playbackTools,
  ...queueTools,
  ...playlistTools,
];
