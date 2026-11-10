import { afterAll, beforeAll, expect, it } from "vitest";
import { z } from "zod";
import { managedBooleanDefault } from "@shepherdjerred/feature-flags/managed-flag-inventory.ts";
import { cloneTestDatabase } from "#testing/postgres.ts";
import { memoryObjectStore } from "#testing/memory-object-store.ts";
import { PrismaUnitOfWork } from "#infrastructure/prisma-unit-of-work.ts";
import { Issues } from "#infrastructure/issues.ts";
import { Collaboration } from "#infrastructure/collaboration.ts";
import { Catalog } from "#infrastructure/catalog.ts";
import { Attachments } from "#infrastructure/attachments.ts";
import { audit } from "#infrastructure/issue-repository.ts";
import {
  CHANGE_HUB_APPLICATION,
  createChangeHub,
  parseChange,
  type ChangeHub,
} from "#infrastructure/change-hub.ts";
import { behaviorConfig } from "#infrastructure/config.ts";
import { createApp } from "#server/app.ts";
import { ActorSchema } from "#shared/actor.ts";
import { LiveMessageSchema, type LiveMessage } from "#shared/contract.ts";
import { CreateIssueSchema, UpdateIssueSchema } from "#shared/schema.ts";

const actor = ActorSchema.parse({
  key: "codex:live-updates",
  name: "Codex",
  kind: "agent",
  metadata: { sessionId: "live-updates" },
});
let suite: Awaited<ReturnType<typeof cloneTestDatabase>>;
let unit: PrismaUnitOfWork;
let issues: Issues;
let collaboration: Collaboration;
const hubs: ChangeHub[] = [];

beforeAll(async () => {
  suite = await cloneTestDatabase(
    z.url().parse(Bun.env["TRACKER_TEST_ADMIN_URL"]),
  );
  unit = new PrismaUnitOfWork(suite.database);
  issues = new Issues(suite.database, unit);
  collaboration = new Collaboration(suite.database, unit);
});
afterAll(async () => {
  await Promise.all(hubs.map((hub) => hub.stop()));
  await suite.close();
});

async function until(condition: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 10_000;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error("Condition was never met");
    await Bun.sleep(10);
  }
}

/** A hub on real PostgreSQL LISTEN, with everything it delivered. */
async function listeningHub(report?: (error: unknown) => void) {
  const hub = createChangeHub(
    suite.url,
    report === undefined ? {} : { report },
  );
  hubs.push(hub);
  await hub.start();
  const received: LiveMessage[] = [];
  let closed = false;
  const unsubscribe = hub.subscribe({
    message: (message) => received.push(message),
    closed: () => {
      closed = true;
    },
  });
  return { hub, received, unsubscribe, isClosed: () => closed };
}

const createIssue = (title: string, requestId: string) =>
  issues.create(
    CreateIssueSchema.parse({ actor, teamKey: "AI", title }),
    requestId,
  );

function appFor(changes: ChangeHub, enabled: boolean, heartbeatMs?: number) {
  return createApp({
    issues,
    collaboration,
    catalog: new Catalog(unit),
    attachments: new Attachments(suite.database, unit, memoryObjectStore()),
    writesEnabled: () => Promise.resolve(true),
    liveUpdatesEnabled: () => Promise.resolve(enabled),
    attachmentMaxBytes: () => Promise.resolve(1000),
    changes,
    ...(heartbeatMs === undefined ? {} : { heartbeatMs }),
  });
}

const hubConnections = async () => {
  const rows = await suite.database.$queryRaw<{ count: number }[]>`
    SELECT count(*)::int AS count FROM pg_stat_activity
    WHERE datname = current_database()
      AND application_name = ${CHANGE_HUB_APPLICATION}`;
  return rows[0]?.count ?? 0;
};

it("publishes exactly one change per committed create, update and comment", async () => {
  const { hub, received, unsubscribe } = await listeningHub();
  const requests = {
    create: crypto.randomUUID(),
    update: crypto.randomUUID(),
    comment: crypto.randomUUID(),
    sentinel: crypto.randomUUID(),
  };
  const issue = await createIssue("Live create", requests.create);
  await issues.update(
    UpdateIssueSchema.parse({
      actor,
      identifier: issue.identifier,
      title: "Live update",
    }),
    requests.update,
  );
  await collaboration.comment(
    { actor, identifier: issue.identifier, body: "Live", attachmentIds: [] },
    requests.comment,
  );
  // Notifications arrive in commit order, so the sentinel bounds the others.
  const sentinel = await createIssue("Live sentinel", requests.sentinel);
  await until(() =>
    received.some((m) => "requestId" in m && m.requestId === requests.sentinel),
  );
  const events = await suite.database.event.findMany({
    where: { requestId: { in: Object.values(requests) } },
    include: { actor: true },
  });
  const expected = [
    [requests.create, "issue", "created", issue.identifier],
    [requests.update, "issue", "updated", issue.identifier],
    [requests.comment, "comment", "created", issue.identifier],
    [requests.sentinel, "issue", "created", sentinel.identifier],
  ] as const;
  expect(received).toEqual(
    expected.map(([requestId, entityType, action, issueIdentifier]) => {
      const event = events.find((row) => row.requestId === requestId);
      if (event === undefined) throw new Error("Missing audit event");
      expect(event.actor.key).toBe(actor.key);
      return {
        type: "change",
        eventId: event.id,
        entityType,
        entityId: event.entityId,
        issueIdentifier,
        action,
        actorId: event.actorId,
        requestId,
        occurredAt: event.occurredAt.toISOString(),
      };
    }),
  );
  expect(events).toHaveLength(4);
  for (const message of received)
    expect(LiveMessageSchema.parse(message)).toEqual(message);
  unsubscribe();
  expect(hub.subscriberCount()).toBe(0);
});

it("publishes only after commit and never for a rolled-back unit of work", async () => {
  const { received, unsubscribe } = await listeningHub();
  const event = {
    entityType: "issue",
    entityId: crypto.randomUUID(),
    action: "updated",
  };
  await expect(
    unit.run(actor, "rolled-back", async (context) => {
      await audit(context, event);
      throw new Error("abandon");
    }),
  ).rejects.toThrow("abandon");
  await unit.run(actor, "committed", async (context) => {
    await audit(context, event);
    // The row exists inside the open transaction; nothing is published yet.
    await Bun.sleep(300);
    expect(received).toEqual([]);
  });
  await until(() => received.length > 0);
  const sentinel = crypto.randomUUID();
  await createIssue("Commit sentinel", sentinel);
  await until(() => received.length >= 2);
  expect(
    received.map((message) => "requestId" in message && message.requestId),
  ).toEqual(["committed", sentinel]);
  unsubscribe();
});

type Frame = Record<string, string>;
/** Read a `text/event-stream` body as frames of `field: value` lines. */
function frameReader(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  return {
    async next(): Promise<Frame> {
      for (;;) {
        const end = buffer.indexOf("\n\n");
        if (end !== -1) {
          const raw = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          return Object.fromEntries(
            raw.split("\n").map((line) => {
              const colon = line.indexOf(":");
              return [line.slice(0, colon), line.slice(colon + 1).trim()];
            }),
          );
        }
        const chunk = await reader.read();
        if (chunk.done) throw new Error("Stream ended");
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    },
    cancel: () => reader.cancel(),
  };
}

it("streams resync, then each change as an SSE frame, and releases the subscriber on abort", async () => {
  const hub = createChangeHub(suite.url);
  hubs.push(hub);
  await hub.start();
  const app = appFor(hub, true, 50);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: app.fetch,
  });
  const origin = `http://127.0.0.1:${String(server.port)}`;
  try {
    const controller = new AbortController();
    const response = await fetch(`${origin}/api/events/stream`, {
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    if (response.body === null) throw new Error("Missing stream body");
    const frames = frameReader(response.body);
    expect(await frames.next()).toEqual({
      event: "resync",
      data: '{"type":"resync"}',
      retry: "3000",
    });
    await until(() => hub.subscriberCount() === 1);
    // An idle stream carries comment frames, which EventSource ignores.
    expect(await frames.next()).toEqual({ "": "heartbeat" });

    // A browser learns the request ID of its own mutation from the response.
    const created = await fetch(`${origin}/trpc/issues.create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actor, teamKey: "AI", title: "Streamed" }),
    });
    expect(created.status).toBe(200);
    const requestId = z.uuid().parse(created.headers.get("x-request-id"));
    let frame = await frames.next();
    while (frame["event"] === undefined) frame = await frames.next();
    const event = await suite.database.event.findFirstOrThrow({
      where: { requestId },
    });
    expect(Object.keys(frame).toSorted()).toEqual(["data", "event", "id"]);
    expect(frame["event"]).toBe("change");
    expect(frame["id"]).toBe(event.id);
    const data: unknown = JSON.parse(frame["data"] ?? "");
    expect(LiveMessageSchema.parse(data)).toEqual({
      type: "change",
      eventId: event.id,
      entityType: "issue",
      entityId: event.entityId,
      issueIdentifier: event.issueIdentifier,
      action: "created",
      actorId: event.actorId,
      requestId,
      occurredAt: event.occurredAt.toISOString(),
    });
    expect(event.issueIdentifier).toMatch(/^AI-\d+$/u);

    controller.abort();
    await until(() => hub.subscriberCount() === 0);
    await createIssue("After abort", crypto.randomUUID());
    await Bun.sleep(200);
    const scrape = await fetch(`${origin}/metrics`);
    const metrics = await scrape.text();
    expect(metrics).toContain("\ntracker_event_stream_clients 0\n");
    expect(metrics).toContain("\ntracker_event_stream_changes_total 1\n");
    expect(metrics).toContain(
      '\ntracker_requests_total{route="events",status="200"} 1\n',
    );
  } finally {
    await server.stop(true);
  }
});

it("returns 404 and opens no LISTEN connection while the flag is off", async () => {
  await Promise.all(hubs.splice(0).map((hub) => hub.stop()));
  await until(async () => (await hubConnections()) === 0);
  const hub = createChangeHub(suite.url);
  hubs.push(hub);
  const response = await appFor(hub, false).request("/api/events/stream");
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "Not found" });
  await Bun.sleep(200);
  expect(hub.listening()).toBe(false);
  expect(hub.subscriberCount()).toBe(0);
  expect(await hubConnections()).toBe(0);
});

it("defaults on in code and in every declared Flipt environment", async () => {
  expect(managedBooleanDefault("tracker-live-updates-enabled", "prod")).toBe(
    true,
  );
  expect(managedBooleanDefault("tracker-live-updates-enabled", "beta")).toBe(
    true,
  );
  // No flag provider is registered here, so this is the code default.
  expect(await behaviorConfig("test").value("liveUpdatesEnabled")).toBe(true);
});

it("tells subscribers to resync after the LISTEN connection is replaced", async () => {
  await Promise.all(hubs.splice(0).map((hub) => hub.stop()));
  await until(async () => (await hubConnections()) === 0);
  const { hub, received, unsubscribe } = await listeningHub();
  await suite.database.$queryRaw`
    SELECT pg_terminate_backend(pid) FROM pg_stat_activity
    WHERE datname = current_database()
      AND application_name = ${CHANGE_HUB_APPLICATION}`;
  await until(() => received.length > 0);
  expect(received).toEqual([{ type: "resync" }]);
  expect(hub.listening()).toBe(true);
  const requestId = crypto.randomUUID();
  await createIssue("After reconnect", requestId);
  await until(() => received.length >= 2);
  expect(received[1]).toMatchObject({ type: "change", requestId });
  unsubscribe();
});

it("reports a payload that breaks the trigger contract and resyncs", async () => {
  const reported: unknown[] = [];
  const { received, unsubscribe } = await listeningHub((error) =>
    reported.push(error),
  );
  await suite.database.$executeRaw`
    SELECT pg_notify('tracker_events', '{"eventId":"only"}')`;
  await until(() => received.length > 0);
  expect(received).toEqual([{ type: "resync" }]);
  expect(reported).toHaveLength(1);
  expect(reported[0]).toBeInstanceOf(z.ZodError);
  expect(() => parseChange("not json")).toThrow(SyntaxError);
  unsubscribe();
});

it("closes subscribers when the hub stops and stays stopped", async () => {
  const { hub, isClosed } = await listeningHub();
  await hub.stop();
  expect(isClosed()).toBe(true);
  expect(hub.subscriberCount()).toBe(0);
  let late = false;
  hub.subscribe({
    message: () => null,
    closed: () => {
      late = true;
    },
  });
  expect(late).toBe(true);
  await hub.start();
  expect(hub.listening()).toBe(false);
});
