export { webTools, fetchUrlTool, webSearchTool } from "./web.js";
export { newsTools, getNewsTool } from "./news.js";
export { lolTools, getLolUpdatesTool } from "./lol.js";

import { webTools } from "./web.js";
import { newsTools } from "./news.js";
import { lolTools } from "./lol.js";

export const allExternalTools = [...webTools, ...newsTools, ...lolTools];
