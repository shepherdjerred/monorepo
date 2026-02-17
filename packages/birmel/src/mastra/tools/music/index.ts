export { playbackTools } from "./playback.js";
export { queueTools } from "./queue.js";
export { controlTools } from "./control.js";

import { playbackTools } from "./playback.js";
import { queueTools } from "./queue.js";
import { controlTools } from "./control.js";

export const allMusicTools = [...playbackTools, ...queueTools, ...controlTools];
