/**
 * A2UI Discord Integration
 * Renders A2UI components as Discord messages with embeds and buttons
 */

// Types
export type {
  // Bound values
  BoundString,
  BoundNumber,
  BoundBoolean,
  BoundArray,
  BoundValue,

  // Children
  ExplicitChildren,
  TemplateChildren,
  Children,

  // Actions
  ActionContext,
  Action,

  // Components
  TextUsageHint,
  TextComponent,
  ButtonComponent,
  CardComponent,
  RowDistribution,
  Alignment,
  RowComponent,
  ColumnDistribution,
  ColumnComponent,
  ListComponent,
  ImageFit,
  ImageUsageHint,
  ImageComponent,
  IconComponent,
  DividerComponent,
  TabItem,
  TabsComponent,
  ProgressIndicatorComponent,
  ComponentDefinition,
  A2UIComponent,

  // Messages
  SurfaceUpdate,
  DataModelEntry,
  DataModelUpdate,
  BeginRendering,
  DeleteSurface,
  A2UIMessage,
  UserAction,
} from "./types.js";

export {
  isSurfaceUpdate,
  isDataModelUpdate,
  isBeginRendering,
  isDeleteSurface,
} from "./types.js";

// Data binding
export type { DataModel } from "./data-binding.js";
export {
  resolveString,
  resolveNumber,
  resolveBoolean,
  resolveValue,
  resolveActionContext,
  dataModelEntriesToObject,
  mergeDataModel,
} from "./data-binding.js";

// Icon mapping
export { iconToDiscordEmoji, getAvailableIcons } from "./icon-map.js";

// Renderer
export type { DiscordMessagePayload, RenderContext } from "./renderer.js";
export { renderToDiscord, parseButtonInteraction } from "./renderer.js";

// Surface manager
export type { Surface, SurfaceState } from "./surface-manager.js";
export { SurfaceManager, createSurfaceManager } from "./surface-manager.js";

// Stream processing
export type { StreamProcessorOptions } from "./stream.js";
export {
  parseNdjsonLine,
  parseNdjson,
  processStream,
  processNdjson,
} from "./stream.js";
