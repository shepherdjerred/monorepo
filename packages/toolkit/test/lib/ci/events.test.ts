import { afterEach, expect, test, vi } from "vitest";
import { SseDecoder, watchEvents } from "#lib/ci/events.ts";

const frame = (repo: number, event: string, ref: string, branch: string) =>
  `data: ${JSON.stringify({ repo: { id: repo }, pipeline: { number: 7, commit: "head", event, ref, branch } })}\n\n`;

afterEach(() => {
  vi.unstubAllGlobals();
});

test("SSE frames preserve partial UTF-8, CRLF and multiline data while ignoring heartbeats", () => {
  const bytes = new TextEncoder().encode(
    ': ping\r\n\r\ndata: {"message":"é"}\r\ndata: second\r\n\r\n',
  );
  const decoder = new SseDecoder();
  const frames: string[] = [];
  for (const byte of bytes)
    frames.push(...decoder.push(new Uint8Array([byte])));
  expect(frames).toEqual(['{"message":"é"}\nsecond']);
  expect(() =>
    decoder.push(new TextEncoder().encode("x".repeat(4_000_001))),
  ).toThrow("size limit");
});

test("stream wakes only the target PR and main in the configured repository", async () => {
  const controller = new AbortController();
  let wakes = 0;
  const fetchMock = vi.fn(
    async () =>
      new Response(
        frame(2, "pull_request", "refs/pull/99/head", "feature") +
          frame(1, "pull_request", "refs/pull/100/head", "feature") +
          frame(1, "pull_request", "refs/pull/99/head", "feature") +
          frame(1, "push", "refs/heads/main", "main"),
        { headers: { "content-type": "text/event-stream" } },
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
  await watchEvents(
    { baseUrl: "https://woodpecker.sjer.red", token: "test", repoId: 1 },
    {
      signal: controller.signal,
      prNumber: 99,
      connected: vi.fn(),
      fatal: vi.fn(),
      wake: () => {
        wakes++;
        if (wakes === 3) controller.abort();
      },
    },
  );
  expect(wakes).toBe(4); // initial snapshot + two relevant events + disconnected refresh
});

test("authentication and malformed frames are terminal rather than endless retries", async () => {
  const fatal = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("", { status: 401 })),
  );
  const options = {
    signal: new AbortController().signal,
    prNumber: 99,
    connected: vi.fn(),
    wake: vi.fn(),
    fatal,
  };
  await watchEvents(
    { baseUrl: "https://woodpecker.sjer.red", token: "test", repoId: 1 },
    options,
  );
  expect(fatal).toHaveBeenCalledTimes(1);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("data: {}\n\n", {
          headers: { "content-type": "text/event-stream" },
        }),
    ),
  );
  await watchEvents(
    { baseUrl: "https://woodpecker.sjer.red", token: "test", repoId: 1 },
    options,
  );
  expect(fatal).toHaveBeenCalledTimes(2);
});
