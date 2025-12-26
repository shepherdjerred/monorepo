/**
 * A2UI Discord - Mastra Integration
 *
 * This module provides Mastra tools for AI agents to create interactive
 * Discord UIs using the A2UI component system.
 *
 * Setup:
 * 1. Call setDiscordClient() with your Discord.js client
 * 2. Call setupInteractionHandler() to handle button clicks
 * 3. Optionally call setActionHandler() to receive action callbacks
 * 4. Add a2uiTools to your Mastra agent's tools
 *
 * Example:
 * ```typescript
 * import { Client } from "discord.js";
 * import {
 *   setDiscordClient,
 *   setupInteractionHandler,
 *   setActionHandler,
 *   a2uiTools,
 * } from "@shepherdjerred/a2ui-discord/mastra";
 *
 * const client = new Client({ ... });
 *
 * // Set up the Discord client
 * setDiscordClient(client);
 *
 * // Set up interaction handling
 * setupInteractionHandler(client);
 *
 * // Handle user actions (optional)
 * setActionHandler((action) => {
 *   console.log(`User ${action.userId} clicked ${action.actionName}`);
 * });
 *
 * // Add tools to your Mastra agent
 * const agent = new Agent({
 *   tools: toolsToRecord(a2uiTools),
 *   // ...
 * });
 * ```
 */

// Surface store
export {
  getSurfaceStore,
  sendSurface,
  updateSurface,
  type ActiveSurface,
  type SurfaceAction,
} from "./surface-store.js";

// Mastra tools
export {
  setDiscordClient,
  setActionHandler,
  getActionHandler,
  createUiCardTool,
  createConfirmDialogTool,
  createProgressTool,
  updateProgressTool,
  createIconListTool,
  deleteUiTool,
  a2uiTools,
} from "./tools.js";

// Interaction handler
export {
  setupInteractionHandler,
  createInteractionMiddleware,
} from "./interaction-handler.js";

// Component builders (for advanced usage)
export {
  uid,
  resetUidCounter,
  literal,
  bound,
  literalNumber,
  boundNumber,
  action,
  text,
  button,
  card,
  row,
  column,
  divider,
  icon,
  progress,
  image,
  surfaceUpdate,
  dataModelUpdate,
  beginRendering,
  infoCard,
  confirmDialog,
  progressCard,
  iconList,
} from "./builders.js";
