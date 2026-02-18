export { playbackTools } from "./playback.js";
export { queueTools } from "./queue.js";

import { playbackTools } from "./playback.ts";
import { queueTools } from "./queue.ts";

export const allMusicTools = [...playbackTools, ...queueTools];
