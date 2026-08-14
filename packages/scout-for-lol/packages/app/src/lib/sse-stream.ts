/**
 * Minimal SSE client for the streaming agent endpoints.
 *
 * `EventSource` is not usable here: these endpoints are POSTs that need the
 * CSRF header and a request body, and EventSource only issues bare GETs. So
 * the frames are parsed by hand off a fetch body.
 */

/**
 * POST JSON and read the SSE response, invoking `onEvent` per frame.
 *
 * `parseEvent` validates each frame. A frame that fails is a corrupted
 * stream — the server validates every event before emitting it — so the
 * caller's message is surfaced instead of a raw JSON or Zod error.
 */
export async function postEventStream<Event>(params: {
  url: string;
  body: unknown;
  signal: AbortSignal;
  csrfToken: string | null;
  parseEvent: (raw: unknown) => Event;
  onEvent: (event: Event) => void;
  httpErrorMessage: (response: Response, text: string) => string;
  corruptedMessage: string;
}): Promise<void> {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (params.csrfToken !== null) {
    headers.set("X-CSRF-Token", params.csrfToken);
  }

  const response = await fetch(params.url, {
    method: "POST",
    credentials: "include",
    headers,
    body: JSON.stringify(params.body),
    signal: params.signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(params.httpErrorMessage(response, text));
  }
  if (response.body === null) {
    throw new Error("The stream returned an empty response.");
  }

  await readEventStream(response.body, (block) => {
    const dataLine = block
      .split("\n")
      .find((line) => line.startsWith("data: "));
    if (dataLine === undefined) {
      return;
    }
    let event: Event;
    try {
      const raw: unknown = JSON.parse(dataLine.slice("data: ".length));
      event = params.parseEvent(raw);
    } catch {
      throw new Error(params.corruptedMessage);
    }
    params.onEvent(event);
  });
}

async function readEventStream(
  body: ReadableStream<Uint8Array>,
  onBlock: (block: string) => void,
): Promise<void> {
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let buffer = "";

  try {
    let read = await reader.read();
    while (!read.done) {
      buffer += decoder.decode(read.value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        onBlock(block);
      }
      read = await reader.read();
    }

    buffer += decoder.decode();
    if (buffer.trim().length > 0) {
      onBlock(buffer);
    }
  } finally {
    reader.releaseLock();
  }
}
