import { createHash } from "node:crypto";
import type {
  NormalizedException,
  NormalizedSentryEvent,
  NormalizedStackFrame,
} from "#domain/envelope-normalize.ts";

const DEFAULT_FINGERPRINT_TOKENS = new Set(["{{ default }}", "{{default}}"]);

export type IssueSummary = {
  readonly type: string;
  readonly value: string;
  readonly transaction: string;
  readonly level: string;
};

function stripUrlOriginAndParams(raw: string): string {
  const trimmed = raw.trim();
  if (/^https?:\/\//iu.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      return parsed.pathname;
    } catch {
      // Fall back to query/hash stripping below
    }
  }
  const withoutScheme = trimmed.replace(
    /^(?:webpack-internal|webpack|vite|app|file):\/+/iu,
    "/",
  );
  const hashIdx = withoutScheme.indexOf("#");
  const noHash =
    hashIdx === -1 ? withoutScheme : withoutScheme.slice(0, hashIdx);
  const queryIdx = noHash.indexOf("?");
  return queryIdx === -1 ? noHash : noHash.slice(0, queryIdx);
}

export function normalizeFrameLocation(
  rawLocation: string | null | undefined,
): string {
  if (rawLocation === undefined || rawLocation === null) {
    return "<anonymous>";
  }
  const stripped = stripUrlOriginAndParams(rawLocation)
    .replaceAll("\\", "/")
    .replace(/:\d+(?::\d+)?$/u, "")
    .replace(/[-.]\w{6,16}\.(m?js|cjs|tsx?|jsx?)$/u, ".$1")
    .replaceAll(/\/{2,}/gu, "/")
    .trim();

  return stripped.length > 0 ? stripped : "<anonymous>";
}

export function normalizeFunctionName(fn: string | null | undefined): string {
  if (fn === undefined || fn === null) {
    return "<anonymous>";
  }
  const trimmed = fn.trim();
  return trimmed === "?" || trimmed.length === 0 ? "<anonymous>" : trimmed;
}

export function parameterizeMessage(raw: string): string {
  return raw
    .replaceAll(
      /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/gu,
      "<ts>",
    )
    .replaceAll(/https?:\/\/[^\s"'<>)+]+/giu, "<url>")
    .replaceAll(
      /\b[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\b/giu,
      "<uuid>",
    )
    .replaceAll(/\b[\da-f]{16,}\b/giu, "<hex>")
    .replaceAll(/\b\d+\b/gu, "<num>");
}

function collectSelectedFrames(
  exceptions: readonly NormalizedException[],
): NormalizedStackFrame[] {
  const allFrames: NormalizedStackFrame[] = [];
  for (const exc of exceptions) {
    for (const frame of exc.frames) {
      allFrames.push(frame);
    }
  }
  if (allFrames.length === 0) {
    return [];
  }
  const inAppFrames = allFrames.filter((frame) => frame.inApp);
  return inAppFrames.length > 0 ? inAppFrames : allFrames;
}

function computeDefaultComponents(event: NormalizedSentryEvent): string[] {
  const primaryException = event.exceptions.at(-1);
  const selectedFrames = collectSelectedFrames(event.exceptions);

  if (selectedFrames.length > 0) {
    const components: string[] = [
      primaryException !== undefined && primaryException.type.trim().length > 0
        ? primaryException.type.trim()
        : "Error",
    ];
    for (const frame of selectedFrames) {
      const location = normalizeFrameLocation(
        frame.module ?? frame.filename ?? frame.absPath,
      );
      const fnName = normalizeFunctionName(frame.function);
      components.push(`${location}:${fnName}`);
    }
    return components;
  }

  const head =
    primaryException !== undefined && primaryException.type.trim().length > 0
      ? primaryException.type.trim()
      : event.level;
  const bodySource =
    primaryException !== undefined && primaryException.value.trim().length > 0
      ? primaryException.value
      : (event.message ?? "");

  return [head, parameterizeMessage(bodySource)];
}

function hasCustomFingerprint(fingerprint: readonly string[]): boolean {
  if (fingerprint.length === 0) {
    return false;
  }
  if (
    fingerprint.length === 1 &&
    fingerprint[0] !== undefined &&
    DEFAULT_FINGERPRINT_TOKENS.has(fingerprint[0].trim())
  ) {
    return false;
  }
  return true;
}

export function computeFingerprint(event: NormalizedSentryEvent): string {
  const defaultComponents = computeDefaultComponents(event);
  let finalComponents: string[];

  if (hasCustomFingerprint(event.fingerprint)) {
    finalComponents = [];
    for (const item of event.fingerprint) {
      if (DEFAULT_FINGERPRINT_TOKENS.has(item.trim())) {
        finalComponents.push(...defaultComponents);
      } else {
        finalComponents.push(item);
      }
    }
  } else {
    finalComponents = defaultComponents;
  }

  return createHash("sha256")
    .update(finalComponents.join("\0"), "utf8")
    .digest("hex");
}

export function extractIssueSummary(
  event: NormalizedSentryEvent,
): IssueSummary {
  const primaryException = event.exceptions.at(-1);
  if (primaryException !== undefined) {
    const type =
      primaryException.type.trim().length > 0
        ? primaryException.type.trim()
        : "Error";
    return {
      type,
      value: primaryException.value,
      transaction: event.transaction,
      level: event.level,
    };
  }

  if (event.message !== null && event.message.trim().length > 0) {
    return {
      type: "Message",
      value: event.message,
      transaction: event.transaction,
      level: event.level,
    };
  }

  return {
    type: "Error",
    value: "<unlabeled event>",
    transaction: event.transaction,
    level: event.level,
  };
}
