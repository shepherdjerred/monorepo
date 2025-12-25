/**
 * Data Binding Resolution
 * Resolves bound values against a data model using JSON pointer paths
 */

import type {
  BoundString,
  BoundNumber,
  BoundBoolean,
  BoundValue,
  ActionContext,
  DataModelEntry,
} from "./types.js";

export type DataModel = Record<string, unknown>;

/**
 * Parse a JSON pointer path and resolve it against the data model
 */
function resolvePath(path: string, dataModel: DataModel): unknown {
  if (!path.startsWith("/")) {
    return undefined;
  }

  const segments = path.slice(1).split("/");
  let current: unknown = dataModel;

  for (const segment of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

/**
 * Resolve a BoundString to its string value
 */
export function resolveString(
  bound: BoundString,
  dataModel: DataModel
): string {
  if (bound.path !== undefined) {
    const resolved = resolvePath(bound.path, dataModel);
    if (typeof resolved === "string") {
      return resolved;
    }
  }
  return bound.literalString ?? "";
}

/**
 * Resolve a BoundNumber to its number value
 */
export function resolveNumber(
  bound: BoundNumber,
  dataModel: DataModel
): number {
  if (bound.path !== undefined) {
    const resolved = resolvePath(bound.path, dataModel);
    if (typeof resolved === "number") {
      return resolved;
    }
  }
  return bound.literalNumber ?? 0;
}

/**
 * Resolve a BoundBoolean to its boolean value
 */
export function resolveBoolean(
  bound: BoundBoolean,
  dataModel: DataModel
): boolean {
  if (bound.path !== undefined) {
    const resolved = resolvePath(bound.path, dataModel);
    if (typeof resolved === "boolean") {
      return resolved;
    }
  }
  return bound.literalBoolean ?? false;
}

/**
 * Resolve a generic BoundValue
 */
export function resolveValue(
  bound: BoundValue,
  dataModel: DataModel
): string | number | boolean | string[] {
  if ("literalString" in bound) {
    return resolveString(bound, dataModel);
  }
  if ("literalNumber" in bound) {
    return resolveNumber(bound, dataModel);
  }
  if ("literalBoolean" in bound) {
    return resolveBoolean(bound, dataModel);
  }
  if ("literalArray" in bound) {
    if (bound.path !== undefined) {
      const resolved = resolvePath(bound.path, dataModel);
      if (Array.isArray(resolved)) {
        return resolved.filter((item): item is string => typeof item === "string");
      }
    }
    return bound.literalArray ?? [];
  }
  // Default case: only path is set, treat as string binding
  if (bound.path !== undefined) {
    return resolveString({ path: bound.path }, dataModel);
  }
  return "";
}

/**
 * Resolve action context to a plain object
 */
export function resolveActionContext(
  context: ActionContext[] | undefined,
  dataModel: DataModel
): Record<string, unknown> {
  if (!context) {
    return {};
  }

  const result: Record<string, unknown> = {};
  for (const item of context) {
    result[item.key] = resolveValue(item.value, dataModel);
  }
  return result;
}

/**
 * Convert DataModelEntry array to a plain object (data model)
 */
export function dataModelEntriesToObject(
  entries: DataModelEntry[]
): DataModel {
  const result: DataModel = {};

  for (const entry of entries) {
    if (entry.valueString !== undefined) {
      result[entry.key] = entry.valueString;
    } else if (entry.valueNumber !== undefined) {
      result[entry.key] = entry.valueNumber;
    } else if (entry.valueBoolean !== undefined) {
      result[entry.key] = entry.valueBoolean;
    } else if (entry.valueMap !== undefined) {
      result[entry.key] = dataModelEntriesToObject(entry.valueMap);
    }
  }

  return result;
}

/**
 * Merge data model updates into an existing data model
 */
export function mergeDataModel(
  existing: DataModel,
  update: DataModelEntry[],
  path?: string
): DataModel {
  const newData = dataModelEntriesToObject(update);

  if (!path) {
    return { ...existing, ...newData };
  }

  // Apply update at specific path
  const segments = path.startsWith("/") ? path.slice(1).split("/") : path.split("/");
  const result = { ...existing };
  let current: Record<string, unknown> = result;

  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    if (segment === undefined) continue;
    if (current[segment] === undefined || typeof current[segment] !== "object") {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }

  const lastSegment = segments[segments.length - 1];
  if (lastSegment !== undefined) {
    current[lastSegment] = newData;
  }

  return result;
}
