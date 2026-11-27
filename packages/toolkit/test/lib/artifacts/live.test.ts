import { expect, test } from "vitest";
import { parseSse, streamLive, type LiveEvent } from "#lib/artifacts/live.ts";
import {
  controlledStream,
  fakeService,
  IDS,
  sseResponse,
} from "#test/support/artifacts.ts";

async function collect(chunks: string[]) {
  const encoder = new TextEncoder();
  async function* source() {
    for (const chunk of chunks) yield encoder.encode(chunk);
  }
  const frames = [];
  for await (const frame of parseSse(source())) frames.push(frame);
  return frames;
}

test("frames split across chunks and CRLF line ends parse the same", async () => {
  const whole =
    'event: feedback\r\nid: 7\r\ndata: {"a":1}\r\n\r\ndata: two\n\n';
  const expected = [
    { event: "feedback", id: "7", data: '{"a":1}' },
    { event: undefined, id: undefined, data: "two" },
  ];
  expect(await collect([whole])).toEqual(expected);
  for (const size of [1, 2, 5]) {
    const chunks: string[] = [];
    for (let at = 0; at < whole.length; at += size)
      chunks.push(whole.slice(at, at + size));
    expect(await collect(chunks)).toEqual(expected);
  }
});

test("comments, unknown fields, and an unfinished event are ignored", async () => {
  expect(
    await collect([
      ": heartbeat\n\nretry: 1000\nfoo: bar\n\ndata: kept\n\ndata: cut off",
    ]),
  ).toEqual([{ event: undefined, id: undefined, data: "kept" }]);
});

test("multi-line data joins with newlines and a bare field name has an empty value", async () => {
  expect(await collect(["data: a\ndata\ndata:b\n\n"])).toEqual([
    { event: undefined, id: undefined, data: "a\n\nb" },
  ]);
});

test("streamLive opens, yields valid messages, and ignores everything else", async () => {
  const feed = controlledStream();
  const service = fakeService({ http: () => sseResponse(feed.stream) });
  const events: LiveEvent[] = [];
  const done = (async () => {
    for await (const event of streamLive(
      service.client(),
      { board: "concepts" },
      new AbortController().signal,
    ))
      events.push(event);
  })();
  feed.raw(": hb\n\n");
  feed.send({
    type: "ready",
    scope: { type: "owner", ownerKey: "k" },
    pending: 0,
  });
  feed.raw("event: heartbeat\ndata: not json\n\n");
  feed.send({ type: "unknown-type" });
  feed.send({
    type: "feedback",
    boardId: IDS.board,
    artifactId: null,
    threadId: IDS.thread,
    commentId: IDS.comment,
    deliverableAt: "2026-11-26T10:00:10.000Z",
  });
  feed.send({ type: "gone" });
  feed.close();
  await done;
  expect(events.map((event) => event.type)).toEqual([
    "open",
    "message",
    "message",
    "message",
  ]);
  expect(service.calls[0]?.path).toBe("/api/feedback/stream?board=concepts");
  expect(service.calls[0]?.headers.get("accept")).toBe("text/event-stream");
});

test("a silent stream is a transient failure so the waiter reconnects", async () => {
  const feed = controlledStream();
  const service = fakeService({ http: () => sseResponse(feed.stream) });
  const consume = async () => {
    for await (const _event of streamLive(
      service.client(),
      {},
      new AbortController().signal,
      { idleMs: 30 },
    )) {
      // Drain.
    }
  };
  await expect(consume()).rejects.toMatchObject({
    kind: "unreachable",
    message: expect.stringContaining("silent") as unknown,
  });
});

test("a refused stream fails with the login fix and a missing route says so", async () => {
  const forbidden = fakeService({
    http: () => new Response("no", { status: 403 }),
  });
  const run = async (service: ReturnType<typeof fakeService>) => {
    for await (const _event of streamLive(
      service.client(),
      {},
      new AbortController().signal,
    )) {
      // Drain.
    }
  };
  await expect(run(forbidden)).rejects.toMatchObject({ kind: "forbidden" });
  const missing = fakeService({
    http: () => new Response("", { status: 404 }),
  });
  await expect(run(missing)).rejects.toMatchObject({ kind: "not-found" });
});
