import { afterEach, describe, expect, test } from "bun:test";
import { postEventStream } from "#src/lib/sse-stream.ts";

/**
 * The property worth pinning is teardown, not parsing.
 *
 * These endpoints stream a turn the server is actively running, and the
 * backend allows one active run per user. Releasing the reader without
 * cancelling leaves the connection — and that run — alive, so the page shows
 * an error while every retry is rejected by a run nobody can see. Cancelling
 * is what the server reads as a disconnect.
 */

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/**
 * `close: false` models the real case these tests are about — the server is
 * still streaming when the client gives up. A stream that has already closed
 * cannot be cancelled, so closing here would make the assertion vacuous.
 */
function streamOf(
  frames: string[],
  options: { close: boolean },
): {
  response: Response;
  cancelled: () => boolean;
} {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) {
        controller.enqueue(new TextEncoder().encode(frame));
      }
      if (options.close) {
        controller.close();
      }
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    response: new Response(body, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    }),
    cancelled: () => cancelled,
  };
}

function run(response: Response, onEvent: (event: unknown) => void) {
  // Object.assign rather than a cast: React's fetch type carries `preconnect`,
  // and the repo bans type assertions.
  globalThis.fetch = Object.assign(() => Promise.resolve(response), {
    preconnect: realFetch.preconnect,
  });
  return postEventStream({
    url: "http://localhost/api/explore/stream",
    body: { question: "Who wins?" },
    signal: new AbortController().signal,
    csrfToken: "csrf",
    parseEvent: (raw: unknown) => raw,
    onEvent,
    httpErrorMessage: () => "http error",
    corruptedMessage: "The stream was corrupted.",
  });
}

/** The frames are irrelevant to the teardown tests; only the cancel is. */
function ignoreEvent(): void {
  return;
}

describe("postEventStream", () => {
  test("delivers well-formed frames", async () => {
    const events: unknown[] = [];
    const { response } = streamOf(
      [
        'event: started\ndata: {"type":"started"}\n\n',
        'event: done\ndata: {"type":"done"}\n\n',
      ],
      { close: true },
    );

    await run(response, (event) => events.push(event));

    expect(events).toEqual([{ type: "started" }, { type: "done" }]);
  });

  test("cancels the body when a frame cannot be parsed", async () => {
    const { response, cancelled } = streamOf(
      [
        'event: started\ndata: {"type":"started"}\n\n',
        "event: broken\ndata: {not json\n\n",
      ],
      { close: false },
    );

    await expect(run(response, ignoreEvent)).rejects.toThrow(/corrupted/i);

    // Without the cancel this is false: the lock is released but the
    // connection — and the server-side run — stay alive.
    expect(cancelled()).toBe(true);
  });

  test("cancels the body when the consumer itself throws", async () => {
    const { response, cancelled } = streamOf(
      ['event: started\ndata: {"type":"started"}\n\n'],
      { close: false },
    );

    await expect(
      run(response, () => {
        throw new Error("consumer exploded");
      }),
    ).rejects.toThrow(/consumer exploded/);

    expect(cancelled()).toBe(true);
  });
});
