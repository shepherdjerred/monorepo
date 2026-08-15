import { z } from "zod";

/**
 * Both stream endpoints answer errors as `{ error, retryAfterSeconds, quota }`
 * (`ReportAiHttpErrorSchema` / `ExploreHttpErrorSchema` — the same shape, each
 * `.strict()` against its own quota snapshot type). Only `error` is read here,
 * so the common field is parsed tolerantly instead of binding this helper to
 * either strict schema — quota drift on one endpoint cannot break the other's
 * error messages.
 */
const StreamHttpErrorBodySchema = z.looseObject({
  error: z.string().trim().min(1),
});

/** A readable message from a non-OK streaming response. */
export function httpErrorMessage(
  response: Response,
  text: string,
  fallbackPrefix: string,
): string {
  if (text.length === 0) {
    return `${fallbackPrefix} (${response.status.toString()}).`;
  }
  try {
    const raw: unknown = JSON.parse(text);
    const parsed = StreamHttpErrorBodySchema.safeParse(raw);
    if (parsed.success) {
      return parsed.data.error;
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
  }
  return text;
}
