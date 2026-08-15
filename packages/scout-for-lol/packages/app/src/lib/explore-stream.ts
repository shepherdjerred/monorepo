import {
  ExploreStreamEventSchema,
  ExploreTranscriptSchema,
  ExploreTurnRequestSchema,
  type ExploreStreamEvent,
  type ExploreTranscript,
  type ExploreTurnRequest,
} from "@scout-for-lol/data";
import { postEventStream } from "#src/lib/sse-stream.ts";
import { httpErrorMessage } from "#src/lib/stream-http-error.ts";
import { readCsrfCookie } from "#src/lib/trpc.ts";

export async function streamExploreTurn(params: {
  input: ExploreTurnRequest;
  signal: AbortSignal;
  onEvent: (event: ExploreStreamEvent) => void;
}): Promise<void> {
  await postEventStream({
    url: "/api/explore/stream",
    body: ExploreTurnRequestSchema.parse(params.input),
    signal: params.signal,
    csrfToken: readCsrfCookie(),
    parseEvent: (raw) => ExploreStreamEventSchema.parse(raw),
    onEvent: params.onEvent,
    httpErrorMessage: (response, text) =>
      httpErrorMessage(response, text, "Explore request failed"),
    corruptedMessage: "The answer stream was corrupted. Please try again.",
  });
}

/**
 * Fetch a shared transcript by token.
 *
 * Deliberately credential-free: this is the read an anonymous visitor makes,
 * and sending cookies would only invite the server to treat it as a session.
 */
export async function fetchSharedTranscript(
  shareToken: string,
  signal?: AbortSignal,
): Promise<ExploreTranscript> {
  const response = await fetch(
    `/api/explore/shared/${encodeURIComponent(shareToken)}`,
    { credentials: "omit", ...(signal === undefined ? {} : { signal }) },
  );
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? "This conversation is not shared, or the link has been revoked."
        : `Could not load this conversation (${response.status.toString()}).`,
    );
  }
  const raw: unknown = await response.json();
  return ExploreTranscriptSchema.parse(raw);
}
