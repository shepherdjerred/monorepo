import { z } from "zod";

const OriginSchema = z
  .url()
  .refine(
    (value) => URL.canParse(value) && new URL(value).origin === value,
    "scheme, host and optional port only, without a trailing slash",
  );

/** A required deployment boundary, shared by WebSocket admission and OAuth. */
export function publicOriginFromEnv(
  env: Record<string, string | undefined>,
): string {
  const origin = env["WEB_PUBLIC_ORIGIN"];
  if (origin === undefined || origin.length === 0) {
    throw new Error(
      "WEB_PUBLIC_ORIGIN is required when the web API is enabled",
    );
  }
  const parsed = OriginSchema.safeParse(origin);
  if (!parsed.success) {
    throw new Error(
      `WEB_PUBLIC_ORIGIN is not an origin: ${parsed.error.issues[0]?.message ?? "invalid"}`,
    );
  }
  return parsed.data;
}
