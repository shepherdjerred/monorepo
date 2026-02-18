export { playbackTools } from "./playback.js";
export { queueTools } from "./queue.js";

import { playbackTools } from "./playback.js";
import { queueTools } from "./queue.js";

export const allMusicTools = [...playbackTools, ...queueTools];
