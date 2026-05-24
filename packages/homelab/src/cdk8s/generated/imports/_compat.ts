import { ApiObject, type ApiObjectMetadata, type GroupVersionKind } from "cdk8s";
import type { Construct } from "constructs";

export interface CompatProps {
  readonly metadata?: ApiObjectMetadata;
  readonly [key: string]: unknown;
}

interface JsonSerializable {
  toJSON(): unknown;
}

function hasJsonSerializer(value: object): value is JsonSerializable {
  return "toJSON" in value && typeof value.toJSON === "function";
}

function normalizeKey(key: string): string {
  if (key === "repoUrl") {
    return "repoURL";
  }
  return key;
}

function normalizeValue(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (hasJsonSerializer(value)) {
    return normalizeValue(value.toJSON());
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item));
  }

  return normalizeObject(value);
}

function normalizeObject(value: object): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    const normalized = normalizeValue(nestedValue);
    if (normalized !== undefined) {
      result[normalizeKey(key)] = normalized;
    }
  }
  return result;
}

export function manifestFor(
  gvk: GroupVersionKind,
  props: CompatProps = {},
): Record<string, unknown> {
  return {
    ...gvk,
    ...normalizeObject(props),
  };
}

export abstract class CompatApiObject extends ApiObject {
  protected constructor(
    scope: Construct,
    id: string,
    gvk: GroupVersionKind,
    props: CompatProps = {},
  ) {
    super(scope, id, {
      ...gvk,
      ...normalizeObject(props),
    });
  }
}
