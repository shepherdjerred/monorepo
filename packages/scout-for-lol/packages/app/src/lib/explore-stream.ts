import {
  ExploreHttpErrorSchema,
  ExploreStreamEventSchema,
  ExploreTranscriptSchema,
  ExploreTurnRequestSchema,
  type ExploreStreamEvent,
  type ExploreTranscript,
  type ExploreTurnRequest,
} from "@scout-for-lol/data";
import { postEventStream } from "#src/lib/sse-stream.ts";
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
    httpErrorMessage: (response, text) => exploreErrorMessage(response, text),
    corruptedMessage: "The answer stream was corrupted. Please try again.",
  });
}

function exploreErrorMessage(response: Response, text: string): string {
  if (text.length === 0) {
    return `Explore request failed (${response.status.toString()}).`;
  }
  try {
    const raw: unknown = JSON.parse(text);
    const parsed = ExploreHttpErrorSchema.safeParse(raw);
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
