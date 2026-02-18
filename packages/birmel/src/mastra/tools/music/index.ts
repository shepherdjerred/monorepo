export { playbackTools } from "./playback.ts";
export { queueTools } from "./queue.ts";

import { playbackTools } from "./playback.ts";
import { queueTools } from "./queue.ts";

export const allMusicTools = [...playbackTools, ...queueTools];
