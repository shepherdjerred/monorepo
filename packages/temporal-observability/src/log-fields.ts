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
  if (fields === undefined) return {};
  return Object.fromEntries(
    Object.entries(fields).filter(
      ([field]) => !isSensitiveTemporalLogField(field),
    ),
  );
}
