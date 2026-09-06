import {
  ReportAiEditRequestSchema,
  ReportAiStreamEventSchema,
  type ReportAiEditRequest,
  type ReportAiStreamEvent,
} from "@scout-for-lol/data";
import { postEventStream } from "#src/lib/streaming/sse-stream.ts";
import { httpErrorMessage } from "#src/lib/streaming/stream-http-error.ts";
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
