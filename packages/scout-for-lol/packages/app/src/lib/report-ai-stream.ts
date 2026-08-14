import {
  ReportAiEditRequestSchema,
  ReportAiHttpErrorSchema,
  ReportAiStreamEventSchema,
  type ReportAiEditRequest,
  type ReportAiStreamEvent,
} from "@scout-for-lol/data";
import { postEventStream } from "#src/lib/sse-stream.ts";
import { readCsrfCookie } from "#src/lib/trpc.ts";

export async function streamReportAiEdit(params: {
  input: ReportAiEditRequest;
  signal: AbortSignal;
  onEvent: (event: ReportAiStreamEvent) => void;
}): Promise<void> {
  await postEventStream({
    url: "/api/reports/query-agent/stream",
    body: ReportAiEditRequestSchema.parse(params.input),
    signal: params.signal,
    csrfToken: readCsrfCookie(),
    parseEvent: (raw) => ReportAiStreamEventSchema.parse(raw),
    onEvent: params.onEvent,
    httpErrorMessage: (response, text) =>
      httpErrorMessage(response, text, "AI report request failed"),
    corruptedMessage: "The AI report stream was corrupted. Please try again.",
  });
}

/**
 * Prefer the server's structured error message, falling back to the raw body
 * and then to the status code.
 */
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
    const parsed = ReportAiHttpErrorSchema.safeParse(raw);
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
