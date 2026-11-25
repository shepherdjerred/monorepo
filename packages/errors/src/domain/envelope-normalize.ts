import { z } from "zod";
import { ErrorLevelSchema } from "#shared/contract.ts";

const JsonValueSchema: z.ZodType = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

export const JsonObjectSchema = z.record(z.string(), JsonValueSchema);

export type NormalizedStackFrame = {
  readonly filename: string | null;
  readonly absPath: string | null;
  readonly module: string | null;
  readonly function: string | null;
  readonly lineno: number | null;
  readonly colno: number | null;
  readonly inApp: boolean;
  readonly preContext: readonly string[];
  readonly contextLine: string | null;
  readonly postContext: readonly string[];
  readonly vars: Record<string, unknown> | null;
};

export type NormalizedException = {
  readonly type: string;
  readonly value: string;
  readonly mechanismType: string | null;
  readonly handled: boolean | null;
  readonly frames: readonly NormalizedStackFrame[];
};

export type NormalizedBreadcrumb = {
  readonly timestamp: string | null;
  readonly type: string | null;
  readonly category: string | null;
  readonly level: string | null;
  readonly message: string | null;
  readonly data: Record<string, unknown> | null;
};

export type NormalizedSdkInfo = {
  readonly name: string | null;
  readonly version: string | null;
};

export type NormalizedSentryEvent = {
  readonly eventId: string;
  readonly timestamp: Date;
  readonly level: string;
  readonly platform: string | null;
  readonly release: string | null;
  readonly environment: string | null;
  readonly transaction: string;
  readonly message: string | null;
  readonly fingerprint: readonly string[];
  readonly exceptions: readonly NormalizedException[];
  readonly breadcrumbs: readonly NormalizedBreadcrumb[];
  readonly tags: Record<string, string>;
  readonly contexts: Record<string, unknown>;
  readonly request: Record<string, unknown> | null;
  readonly sdk: NormalizedSdkInfo | null;
  readonly rawData: Record<string, unknown>;
};

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asIntOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : null;
}

function asPlainObject(value: unknown): Record<string, unknown> | null {
  const parsed = JsonObjectSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      result.push(item);
    }
  }
  return result;
}

function dateFromEpochNumber(raw: number): Date | null {
  if (!Number.isFinite(raw)) {
    return null;
  }
  const millis = raw > 1_000_000_000_000 ? raw : raw * 1000;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeTimestamp(raw: unknown): Date {
  if (typeof raw === "number") {
    return dateFromEpochNumber(raw) ?? new Date();
  }
  if (typeof raw === "string" && raw.trim().length > 0) {
    const fromNumeric = dateFromEpochNumber(Number(raw));
    if (fromNumeric !== null) {
      return fromNumeric;
    }
    const isoDate = new Date(raw);
    if (!Number.isNaN(isoDate.getTime())) {
      return isoDate;
    }
  }
  return new Date();
}

function normalizeLevel(raw: unknown): string {
  if (typeof raw !== "string") {
    return "error";
  }
  const lowered = raw.trim().toLowerCase();
  if (lowered === "warn") {
    return "warning";
  }
  const parsed = ErrorLevelSchema.safeParse(lowered);
  return parsed.success ? parsed.data : "error";
}

function normalizeFrame(raw: unknown): NormalizedStackFrame | null {
  const obj = asPlainObject(raw);
  if (obj === null) {
    return null;
  }
  const filename = asNonEmptyString(obj["filename"]);
  const absPath = asNonEmptyString(obj["abs_path"]);
  return {
    filename: filename ?? absPath,
    absPath,
    module: asNonEmptyString(obj["module"]),
    function: asNonEmptyString(obj["function"]),
    lineno: asIntOrNull(obj["lineno"]),
    colno: asIntOrNull(obj["colno"]),
    inApp: obj["in_app"] !== false,
    preContext: asStringArray(obj["pre_context"]),
    contextLine: asStringOrNull(obj["context_line"]),
    postContext: asStringArray(obj["post_context"]),
    vars: asPlainObject(obj["vars"]),
  };
}

function normalizeFramesFromStacktrace(
  stacktraceRaw: unknown,
): NormalizedStackFrame[] {
  const obj = asPlainObject(stacktraceRaw);
  if (obj === null || !Array.isArray(obj["frames"])) {
    return [];
  }
  const frames: NormalizedStackFrame[] = [];
  for (const frameItem of obj["frames"]) {
    const normalized = normalizeFrame(frameItem);
    if (normalized !== null) {
      frames.push(normalized);
    }
  }
  return frames;
}

function normalizeSingleException(raw: unknown): NormalizedException | null {
  const obj = asPlainObject(raw);
  if (obj === null) {
    return null;
  }
  const mechanism = asPlainObject(obj["mechanism"]);
  const handledRaw = mechanism?.["handled"];
  return {
    type: asNonEmptyString(obj["type"]) ?? "Error",
    value: asStringOrNull(obj["value"]) ?? "",
    mechanismType: asNonEmptyString(mechanism?.["type"]),
    handled: typeof handledRaw === "boolean" ? handledRaw : null,
    frames: normalizeFramesFromStacktrace(obj["stacktrace"]),
  };
}

function normalizeExceptions(
  rawPayload: Record<string, unknown>,
  message: string | null,
): NormalizedException[] {
  const rawException = rawPayload["exception"];
  let rawValues: unknown[] = [];
  if (Array.isArray(rawException)) {
    rawValues = rawException;
  } else {
    const excObj = asPlainObject(rawException);
    if (excObj !== null && Array.isArray(excObj["values"])) {
      rawValues = excObj["values"];
    }
  }

  const exceptions: NormalizedException[] = [];
  for (const item of rawValues) {
    const normalized = normalizeSingleException(item);
    if (normalized !== null) {
      exceptions.push(normalized);
    }
  }

  if (exceptions.length === 0 && rawPayload["stacktrace"] !== undefined) {
    const topFrames = normalizeFramesFromStacktrace(rawPayload["stacktrace"]);
    if (topFrames.length > 0) {
      exceptions.push({
        type: "Error",
        value: message ?? "",
        mechanismType: null,
        handled: null,
        frames: topFrames,
      });
    }
  }
  return exceptions;
}

function normalizeBreadcrumbs(rawBreadcrumbs: unknown): NormalizedBreadcrumb[] {
  let rawList: unknown[] = [];
  if (Array.isArray(rawBreadcrumbs)) {
    rawList = rawBreadcrumbs;
  } else {
    const obj = asPlainObject(rawBreadcrumbs);
    if (obj !== null && Array.isArray(obj["values"])) {
      rawList = obj["values"];
    }
  }

  const breadcrumbs: NormalizedBreadcrumb[] = [];
  for (const entry of rawList) {
    const obj = asPlainObject(entry);
    if (obj !== null) {
      const rawTs = obj["timestamp"];
      let timestamp: string | null = null;
      if (typeof rawTs === "number" && Number.isFinite(rawTs)) {
        timestamp = normalizeTimestamp(rawTs).toISOString();
      } else if (typeof rawTs === "string" && rawTs.trim().length > 0) {
        timestamp = rawTs.trim();
      }
      breadcrumbs.push({
        timestamp,
        type: asNonEmptyString(obj["type"]),
        category: asNonEmptyString(obj["category"]),
        level: asNonEmptyString(obj["level"]),
        message: asStringOrNull(obj["message"]),
        data: asPlainObject(obj["data"]),
      });
    }
  }
  return breadcrumbs;
}

function stringifyTagValue(val: unknown): string {
  if (typeof val === "string") {
    return val;
  }
  return typeof val === "number" || typeof val === "boolean"
    ? String(val)
    : JSON.stringify(val);
}

const TagTupleListSchema = z.array(
  z.tuple([z.unknown(), z.unknown()]).rest(z.unknown()),
);

function normalizeTagsFromTuples(rawTags: unknown[]): Record<string, string> {
  const tags: Record<string, string> = {};
  const parsed = TagTupleListSchema.safeParse(rawTags);
  if (!parsed.success) {
    return tags;
  }
  for (const tuple of parsed.data) {
    const key = asNonEmptyString(tuple[0]);
    const val = tuple[1];
    if (key !== null && val !== undefined && val !== null) {
      tags[key] = stringifyTagValue(val);
    }
  }
  return tags;
}

function normalizeTags(rawTags: unknown): Record<string, string> {
  if (Array.isArray(rawTags)) {
    return normalizeTagsFromTuples(rawTags);
  }
  const tags: Record<string, string> = {};
  const obj = asPlainObject(rawTags);
  if (obj !== null) {
    for (const [key, val] of Object.entries(obj)) {
      if (val !== undefined && val !== null && key.trim().length > 0) {
        tags[key] = stringifyTagValue(val);
      }
    }
  }
  return tags;
}

function extractMessageText(
  rawPayload: Record<string, unknown>,
): string | null {
  const directMessage = rawPayload["message"];
  if (typeof directMessage === "string" && directMessage.length > 0) {
    return directMessage;
  }
  const msgObj = asPlainObject(directMessage);
  if (msgObj !== null) {
    const formatted =
      asNonEmptyString(msgObj["formatted"]) ??
      asNonEmptyString(msgObj["message"]);
    if (formatted !== null) {
      return formatted;
    }
  }
  const logentry = asPlainObject(rawPayload["logentry"]);
  return logentry === null
    ? null
    : (asNonEmptyString(logentry["formatted"]) ??
        asNonEmptyString(logentry["message"]));
}

export function normalizeSentryEventPayload(
  rawPayload: Record<string, unknown>,
  fallbackEventId?: string,
  fallbackSdk: NormalizedSdkInfo | null = null,
): NormalizedSentryEvent {
  const eventId =
    asNonEmptyString(rawPayload["event_id"]) ??
    (fallbackEventId !== undefined && fallbackEventId.trim().length > 0
      ? fallbackEventId.trim()
      : crypto.randomUUID().replaceAll("-", ""));

  const message = extractMessageText(rawPayload);
  const sdkObj = asPlainObject(rawPayload["sdk"]);
  const sdk: NormalizedSdkInfo | null =
    sdkObj === null
      ? fallbackSdk
      : {
          name: asNonEmptyString(sdkObj["name"]),
          version: asNonEmptyString(sdkObj["version"]),
        };

  return {
    eventId,
    timestamp: normalizeTimestamp(rawPayload["timestamp"]),
    level: normalizeLevel(rawPayload["level"]),
    platform: asNonEmptyString(rawPayload["platform"]),
    release: asNonEmptyString(rawPayload["release"]),
    environment: asNonEmptyString(rawPayload["environment"]),
    transaction: asNonEmptyString(rawPayload["transaction"]) ?? "",
    message,
    fingerprint: asStringArray(rawPayload["fingerprint"]),
    exceptions: normalizeExceptions(rawPayload, message),
    breadcrumbs: normalizeBreadcrumbs(rawPayload["breadcrumbs"]),
    tags: normalizeTags(rawPayload["tags"]),
    contexts: asPlainObject(rawPayload["contexts"]) ?? {},
    request: asPlainObject(rawPayload["request"]),
    sdk,
    rawData: rawPayload,
  };
}
