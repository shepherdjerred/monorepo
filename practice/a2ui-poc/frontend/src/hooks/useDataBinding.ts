import type { BoundValue, BoundString, BoundNumber, BoundBoolean } from "../a2ui/types";

/**
 * Resolve a JSON pointer path against a data model
 */
function getValueAtPath(dataModel: Record<string, unknown>, path: string): unknown {
  if (!path || path === "/") {
    return dataModel;
  }

  // Remove leading slash and split by /
  const parts = path.replace(/^\//, "").split("/");
  let current: unknown = dataModel;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (typeof current === "object") {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * Resolve a bound value (literal or path reference) against a data model
 */
export function resolveBinding(
  bound: BoundValue | undefined,
  dataModel: Record<string, unknown>
): string | number | boolean | undefined {
  if (!bound) {
    return undefined;
  }

  // Check for literal values first
  if ("literalString" in bound && bound.literalString !== undefined) {
    // If there's also a path, the literal is the default
    if ("path" in bound && bound.path) {
      const pathValue = getValueAtPath(dataModel, bound.path);
      if (pathValue !== undefined) {
        return String(pathValue);
      }
    }
    return bound.literalString;
  }

  if ("literalNumber" in bound && bound.literalNumber !== undefined) {
    if ("path" in bound && bound.path) {
      const pathValue = getValueAtPath(dataModel, bound.path);
      if (pathValue !== undefined && typeof pathValue === "number") {
        return pathValue;
      }
    }
    return bound.literalNumber;
  }

  if ("literalBoolean" in bound && bound.literalBoolean !== undefined) {
    if ("path" in bound && bound.path) {
      const pathValue = getValueAtPath(dataModel, bound.path);
      if (pathValue !== undefined && typeof pathValue === "boolean") {
        return pathValue;
      }
    }
    return bound.literalBoolean;
  }

  // Only path, no literal default
  if ("path" in bound && bound.path) {
    const value = getValueAtPath(dataModel, bound.path);
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return value;
    }
  }

  return undefined;
}

/**
 * Resolve a bound string specifically
 */
export function resolveString(
  bound: BoundString | undefined,
  dataModel: Record<string, unknown>
): string {
  const result = resolveBinding(bound, dataModel);
  return result !== undefined ? String(result) : "";
}

/**
 * Resolve a bound number specifically
 */
export function resolveNumber(
  bound: BoundNumber | undefined,
  dataModel: Record<string, unknown>
): number {
  const result = resolveBinding(bound, dataModel);
  return typeof result === "number" ? result : 0;
}

/**
 * Resolve a bound boolean specifically
 */
export function resolveBoolean(
  bound: BoundBoolean | undefined,
  dataModel: Record<string, unknown>
): boolean {
  const result = resolveBinding(bound, dataModel);
  return result === true;
}

/**
 * Resolve action context values
 */
export function resolveActionContext(
  context: Array<{ key: string; value: BoundValue }> | undefined,
  dataModel: Record<string, unknown>
): Record<string, unknown> {
  if (!context) {
    return {};
  }

  const resolved: Record<string, unknown> = {};
  for (const { key, value } of context) {
    resolved[key] = resolveBinding(value, dataModel);
  }
  return resolved;
}
