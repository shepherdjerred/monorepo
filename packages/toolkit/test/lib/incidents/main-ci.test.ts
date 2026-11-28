import { afterEach, expect, test } from "vitest";
import {
  formatMainCiIncident,
  mainCiIncident,
} from "#lib/incidents/main-ci.ts";
import { agentActor, startTestHub, type TestHub } from "./harness.ts";

const hubs: TestHub[] = [];
const servers: ReturnType<typeof Bun.serve>[] = [];

afterEach(async () => {
  for (const hub of hubs.splice(0)) await hub.hub.stop();
  for (const server of servers.splice(0)) await server.stop(true);
});

test("a red main reports the open main-ci incident and the command to run", async () => {
  const hub = await startTestHub();
  hubs.push(hub);
  const waiter = agentActor("blocked");

  const report = await mainCiIncident({ baseUrl: hub.hub.url, actor: waiter });

  expect(report).toMatchObject({
    available: true,
    incident: { commandState: "owned", status: expect.any(String) },
    relation: { suspect: false, commander: false },
  });
  if (!report.available || report.incident === null) throw new Error("open");
  const id = report.incident.identifier;
  expect(report.recommended).toBe(`toolkit incident wait ${id}`);
  expect(formatMainCiIncident(report)).toContain(
    `Blocked by ${id}; wait for it (joins as affected, takes over if nobody does): toolkit incident wait ${id}`,
  );
});

test("the suspect of an unowned main-ci incident is told to take it", async () => {
  const hub = await startTestHub();
  hubs.push(hub);
  const owned = await hub.api.check({ system: "main-ci" });
  const existing = owned.incidents[0]?.incident;
  if (existing === undefined) throw new Error("fixture main-ci incident");
  const commander = existing.command.commander;
  if (commander === null) throw new Error("fixture main-ci is owned");
  const detail = await hub.api.byRef(existing.identifier);
  await hub.api.handoff({
    actor: { key: commander.key, kind: "agent", name: commander.name },
    ref: existing.identifier,
    expectedRevision: detail.revision,
    to: null,
    note: "Stepping back",
  });
  const suspect = agentActor("suspect", {
    branch: detail.suspect?.branch ?? "missing",
  });

  const report = await mainCiIncident({ baseUrl: hub.hub.url, actor: suspect });

  expect(report).toMatchObject({
    available: true,
    relation: { suspect: true },
    recommended: `toolkit incident take ${existing.identifier}`,
  });
});

test("no open main-ci incident recommends declaring one", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () =>
      Response.json({
        result: {
          data: { checkedAt: "2026-11-25T12:00:00.000Z", incidents: [] },
        },
      }),
  });
  servers.push(server);

  const report = await mainCiIncident({
    baseUrl: server.url.toString(),
    actor: null,
  });

  expect(report).toMatchObject({ available: true, incident: null });
  expect(formatMainCiIncident(report)).toContain(
    "toolkit incident declare --system main-ci",
  );
});

test.each([
  ["an unreachable Hub", () => "http://127.0.0.1:9"],
  [
    "a drifted response",
    () => {
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: () => Response.json({ result: { data: { nope: true } } }),
      });
      servers.push(server);
      return server.url.toString();
    },
  ],
  [
    "a server error",
    () => {
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: () => new Response("upstream token=secret", { status: 502 }),
      });
      servers.push(server);
      return server.url.toString();
    },
  ],
])("%s becomes a warning line instead of an error", async (_name, url) => {
  const report = await mainCiIncident({
    baseUrl: url(),
    actor: null,
    timeoutMs: 1000,
  });

  expect(report.available).toBe(false);
  const line = formatMainCiIncident(report);
  expect(line).toMatch(/^Warning: main-ci incident lookup failed/u);
  expect(line).toContain("toolkit incident check --system main-ci");
  expect(line).not.toContain("secret");
});
