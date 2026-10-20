import { z } from "zod";

const SENSITIVE_FIELD_SEGMENTS = [
  "args",
  "apikey",
  "authorization",
  "cookie",
  "credential",
  "input",
  "password",
  "payload",
  "playerdata",
  "prompt",
  "reportbody",
  "result",
  "secret",
  "tasktoken",
  "token",
] as const;

function normalizedFieldName(field: string): string {
  return field.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

export function isSensitiveTemporalLogField(field: string): boolean {
  const normalized = normalizedFieldName(field);
  return SENSITIVE_FIELD_SEGMENTS.some((segment) =>
    normalized.includes(segment),
  );
}

/**
 * Remove fields that can contain Temporal payloads or application credentials.
 *
 * Temporal's default Activity log attributes include the base64 task token.
 * Runtime log callbacks must apply this filter before serializing SDK metadata;
 * values are never inspected or included in diagnostics.
 */
export function sanitizeTemporalLogFields(
  fields: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> {
  return fields === undefined
    ? {}
    : Object.fromEntries(
        Object.entries(fields).filter(
          ([field]) => !isSensitiveTemporalLogField(field),
        ),
      );
}

export type SerializedLogError = {
  name: string;
  message: string;
  stack?: string;
  cause?: SerializedLogErrorCause;
};

type SerializedLogErrorCause =
  SerializedLogError | string | number | boolean | null;

const PrimitiveCauseSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

// Temporal failures chain ActivityFailure -> ApplicationFailure -> original
// error; a few levels keep the reason while bounding a cyclic cause chain.
const MAX_LOG_ERROR_CAUSE_DEPTH = 5;

function serializeLogErrorCause(
  cause: unknown,
  depth: number,
): SerializedLogErrorCause {
  if (cause instanceof Error || cause instanceof DOMException) {
    return depth >= MAX_LOG_ERROR_CAUSE_DEPTH
      ? { name: cause.name, message: cause.message }
      : serializeLogError(cause, depth);
  }
  const primitive = PrimitiveCauseSchema.safeParse(cause);
  // A non-Error object cause can carry a payload; record only its kind.
  return primitive.success ? primitive.data : `[${typeof cause}]`;
}

/**
 * Convert an Error (including DOMException) into plain fields.
 * `JSON.stringify` of an Error is `{}` because its name, message, stack and
 * cause are not own enumerable properties, which erased the reason from SDK
 * "Activity failed" logs. Failure details and other enumerable properties are
 * not copied, since Temporal failures can carry payloads there.
 */
export function serializeLogError(
  error: Error | DOMException,
  depth = 0,
): SerializedLogError {
  const serialized: SerializedLogError = {
    name: error.name,
    message: error.message,
  };
  if (error.stack !== undefined) {
    serialized.stack = error.stack;
  }
  const cause: unknown = error.cause;
  if (cause !== undefined) {
    serialized.cause = serializeLogErrorCause(cause, depth + 1);
  }
  return serialized;
}

/** Replace top-level Error values with their serialized fields. */
export function serializeLogErrorFields(
  fields: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([field, value]) => [
      field,
      value instanceof Error || value instanceof DOMException
        ? serializeLogError(value)
        : value,
    ]),
  );
}
