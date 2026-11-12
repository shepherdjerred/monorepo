import { afterEach, expect, test, vi } from "vitest";
import { SseDecoder, watchEvents } from "#lib/ci/events.ts";

const frame = (
  repo: number,
  event: string,
  ref: string,
  metadata: {
    branch: string;
    event_reason?: readonly string[];
    status?: string;
    commit?: string;
  },
) =>
  `data: ${JSON.stringify({ repo: { id: repo }, pipeline: { number: 7, commit: "head", event, ref, status: "running", ...metadata } })}\n\n`;

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

test("stream wakes only the target PR and finished main runs in the configured repository", async () => {
  const controller = new AbortController();
  let wakes = 0;
  const commits: string[] = [];
  const fetchMock = vi.fn(
    async () =>
      new Response(
        frame(2, "pull_request", "refs/pull/99/head", { branch: "feature" }) +
          frame(1, "pull_request", "refs/pull/100/head", {
            branch: "feature",
          }) +
          frame(1, "pull_request", "refs/pull/99/head", {
            branch: "feature",
            commit: "pushed",
          }) +
          // A running main pipeline's step events do not wake a PR wait.
          frame(1, "push", "refs/heads/main", { branch: "main" }) +
          frame(1, "manual", "refs/heads/main", { branch: "main" }) +
          frame(1, "manual", "refs/heads/feature", {
            branch: "main",
            status: "success",
          }) +
          frame(1, "manual", "refs/heads/main", {
            branch: "main",
            status: "failure",
          }) +
          frame(1, "push", "refs/heads/main", {
            branch: "main",
            status: "success",
          }),
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
      prCommit: (commit) => commits.push(commit),
      wake: () => {
        wakes++;
        if (wakes === 4) controller.abort();
      },
    },
  );
  expect(commits).toEqual(["pushed"]);
  expect(wakes).toBe(5); // initial snapshot + three relevant events + disconnected refresh
});

test("a main wait wakes for every main event, including running steps", async () => {
  const controller = new AbortController();
  let wakes = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          frame(1, "push", "refs/heads/main", { branch: "main" }) +
            frame(1, "pull_request", "refs/pull/99/head", {
              branch: "feature",
            }) +
            frame(1, "push", "refs/heads/main", { branch: "main" }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    ),
  );
  await watchEvents(
    { baseUrl: "https://woodpecker.sjer.red", token: "test", repoId: 1 },
    {
      signal: controller.signal,
      prNumber: null,
      connected: vi.fn(),
      fatal: vi.fn(),
      wake: () => {
        wakes++;
        if (wakes === 3) controller.abort();
      },
    },
  );
  expect(wakes).toBe(4); // initial snapshot + two main events + disconnected refresh
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

test("a ready-for-review event wakes observation while unrelated metadata does not", async () => {
  const controller = new AbortController();
  let wakes = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          frame(1, "pull_request_metadata", "refs/pull/99/head", {
            branch: "main",
            event_reason: ["edited"],
          }) +
            frame(1, "pull_request_metadata", "refs/pull/100/head", {
              branch: "main",
              event_reason: ["ready_for_review"],
            }) +
            frame(1, "pull_request_metadata", "refs/pull/99/head", {
              branch: "main",
              event_reason: ["ready_for_review"],
            }),
          { headers: { "content-type": "text/event-stream" } },
        ),
    ),
  );
  const fatal = vi.fn();
  await watchEvents(
    { baseUrl: "https://woodpecker.sjer.red", token: "test", repoId: 1 },
    {
      signal: controller.signal,
      prNumber: 99,
      connected: vi.fn(),
      fatal,
      wake: () => {
        wakes++;
        if (wakes === 2) controller.abort();
      },
    },
  );
  expect(fatal).not.toHaveBeenCalled();
  expect(wakes).toBe(3);
});
