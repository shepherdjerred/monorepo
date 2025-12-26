/**
 * A2UI Message Builders
 * Helper functions to construct A2UI protocol messages
 */

import type {
  A2UIComponent,
  A2UIMessage,
  DataModelEntry,
  SurfaceUpdate,
  DataModelUpdate,
  BeginRendering,
  DeleteSurface,
} from "./types.js";

export function surfaceUpdate(
  surfaceId: string,
  components: A2UIComponent[]
): SurfaceUpdate {
  return {
    surfaceUpdate: {
      surfaceId,
      components,
    },
  };
}

export function dataModelUpdate(
  surfaceId: string,
  contents: DataModelEntry[],
  path?: string
): DataModelUpdate {
  const update: DataModelUpdate["dataModelUpdate"] = {
    surfaceId,
    contents,
  };
  if (path) {
    update.path = path;
  }
  return {
    dataModelUpdate: update,
  };
}

export function beginRendering(
  surfaceId: string,
  root: string,
  options?: {
    catalogId?: string;
    styles?: Record<string, unknown>;
  }
): BeginRendering {
  return {
    beginRendering: {
      surfaceId,
      root,
      ...options,
    },
  };
}

export function deleteSurface(surfaceId: string): DeleteSurface {
  return {
    deleteSurface: { surfaceId },
  };
}

// ============= Data Model Helpers =============

/**
 * Convert a plain object to DataModelEntry array
 */
export function toDataModelEntries(
  obj: Record<string, unknown>
): DataModelEntry[] {
  return Object.entries(obj).map(([key, value]) => {
    if (typeof value === "string") {
      return { key, valueString: value };
    } else if (typeof value === "number") {
      return { key, valueNumber: value };
    } else if (typeof value === "boolean") {
      return { key, valueBoolean: value };
    } else if (Array.isArray(value)) {
      // Convert array to indexed object
      return {
        key,
        valueMap: value.map((item, index) => {
          if (typeof item === "object" && item !== null) {
            return {
              key: String(index),
              valueMap: toDataModelEntries(item as Record<string, unknown>),
            };
          }
          return {
            key: String(index),
            valueString: String(item),
          };
        }),
      };
    } else if (typeof value === "object" && value !== null) {
      return {
        key,
        valueMap: toDataModelEntries(value as Record<string, unknown>),
      };
    }
    return { key, valueString: String(value) };
  });
}

// ============= Streaming Helpers =============

/**
 * Convert A2UI messages to JSONL format for streaming
 */
export function* streamMessages(messages: A2UIMessage[]): Generator<string> {
  for (const message of messages) {
    yield JSON.stringify(message) + "\n";
  }
}

/**
 * Generate a unique surface ID
 */
export function generateSurfaceId(prefix = "surface"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
