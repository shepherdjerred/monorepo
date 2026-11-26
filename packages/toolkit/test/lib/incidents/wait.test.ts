import { afterEach, describe, expect, test, vi } from "vitest";
import type { ActorInput } from "@shepherdjerred/incidents/contract";
import type { IncidentStream } from "#lib/incidents/stream.ts";
import { waitForIncident, type WaitResult } from "#lib/incidents/wait.ts";
import {
  agentActor,
  fakeSpawns,
  REPO,
  startTestHub,
  type TestHub,
} from "./harness.ts";

const GRACE_MS = 600_000;
const hubs: TestHub[] = [];
const aborts: AbortController[] = [];
const waiters: Promise<WaitResult>[] = [];

afterEach(async () => {
  for (const controller of aborts.splice(0)) controller.abort();
  await Promise.allSettled(waiters.splice(0));
  for (const testHub of hubs.splice(0)) await testHub.hub.stop();
});

async function newHub(
  settings: Parameters<typeof startTestHub>[0] = {},
): Promise<TestHub> {
  const started = await startTestHub(settings);
  hubs.push(started);
  return started;
}

const settle = { timeout: 5000, interval: 10 };

async function timelineOf(hub: TestHub, ref: string) {
  const detail = await hub.api.byRef(ref);
  return detail.timeline;
}

async function commandStateOf(hub: TestHub, ref: string) {
  const detail = await hub.api.byRef(ref);
  return detail.command.state;
}

async function affectedKeys(hub: TestHub, ref: string): Promise<string[]> {
  const detail = await hub.api.byRef(ref);
  return detail.affected.map((entry) => entry.actor.key);
}

function startWaiter(
  hub: TestHub,
  actor: ActorInput,
  spawner: Parameters<TestHub["deps"]>[1],
  options: { ref: string; spawn?: boolean; timeoutMs?: number },
): Promise<WaitResult> {
  const controller = new AbortController();
  aborts.push(controller);
  const waiting = waitForIncident(hub.deps(actor, spawner), {
    ref: options.ref,
    spawn: options.spawn ?? true,
    timeoutMs: options.timeoutMs,
    signal: controller.signal,
  });
  waiters.push(waiting);
  return waiting;
}

describe("toolkit incident wait", () => {
  test("a suspect is told to take it and never joins or waits", async () => {
    const hub = await newHub();
    const incident = await hub.declare({
      systems: ["storage"],
      suspect: { sessionId: "session_01Suspect" },
    });
    const suspect = agentActor("suspect", { sessionId: "session_01Suspect" });
    const spawns = fakeSpawns();

    const outcome = await startWaiter(hub, suspect, spawns.spawnerFor("s"), {
      ref: incident.identifier,
    });

    expect(outcome).toMatchObject({
      outcome: "suspect",
      incident: { identifier: incident.identifier },
      dispatches: [],
    });
    await expect(affectedKeys(hub, incident.identifier)).resolves.toEqual([]);
    expect(spawns.calls).toEqual([]);
  });

  test("an already-resolved incident and an unknown system both exit at once", async () => {
    const hub = await newHub();
    const waiter = agentActor("a");
    const spawns = fakeSpawns();
    const resolved = await hub.api.list({ state: "resolved" });
    const target = resolved[0];
    if (target === undefined)
      throw new Error("fixture has a resolved incident");

    await expect(
      startWaiter(hub, waiter, spawns.spawnerFor("a"), {
        ref: target.identifier,
      }),
    ).resolves.toMatchObject({ outcome: "resolved" });
    await expect(
      waitForIncident(hub.deps(waiter, spawns.spawnerFor("a")), {
        system: "network",
        spawn: true,
      }),
    ).resolves.toEqual({
      outcome: "nothing-open",
      system: "network",
      dispatches: [],
    });
  });

  test("joins as affected and exits 0 when the commander resolves", async () => {
    const hub = await newHub();
    const incident = await hub.declare({
      systems: ["storage"],
      takeCommand: true,
    });
    const waiter = agentActor("a");
    const spawns = fakeSpawns();

    const waiting = startWaiter(hub, waiter, spawns.spawnerFor("a"), {
      ref: incident.identifier,
    });
    await vi.waitFor(async () => {
      await expect(affectedKeys(hub, incident.identifier)).resolves.toEqual([
        waiter.key,
      ]);
    }, settle);
    const current = await hub.api.byRef(incident.identifier);
    await hub.api.resolve({
      actor: {
        key: "claude-code:declarer",
        kind: "agent",
        name: "claude-code",
        metadata: { branch: "declarer-branch" },
      },
      ref: incident.identifier,
      expectedRevision: current.revision,
      note: "Pool remounted read-write; a probe write succeeded.",
    });

    await expect(waiting).resolves.toMatchObject({
      outcome: "resolved",
      incident: { identifier: incident.identifier, status: "resolved" },
      dispatches: [],
    });
    expect(spawns.calls).toEqual([]);
  });
});

describe("toolkit incident wait takeover", () => {
  test("two waiters on one server: exactly one spawns a commander, the other keeps waiting", async () => {
    const hub = await newHub();
    const incident = await hub.declare({
      systems: ["storage"],
      links: [
        { kind: "pr", ref: "5150", url: "https://github.com/o/r/pull/5150" },
      ],
    });
    const id = incident.identifier;
    const [a, b] = [agentActor("a"), agentActor("b")];
    const spawns = fakeSpawns();
    const waitA = startWaiter(hub, a, spawns.spawnerFor("a"), { ref: id });
    const waitB = startWaiter(hub, b, spawns.spawnerFor("b"), { ref: id });
    await vi.waitFor(async () => {
      const keys = await affectedKeys(hub, id);
      expect(keys.toSorted()).toEqual([a.key, b.key]);
      expect(hub.scheduler.pending()).toBeGreaterThanOrEqual(2);
    }, settle);
    expect(spawns.calls).toEqual([]);

    hub.scheduler.advance(GRACE_MS);
    await vi.waitFor(async () => {
      expect(spawns.calls).toHaveLength(1);
      const timeline = await timelineOf(hub, id);
      expect(
        timeline.some(
          (event) =>
            event.body?.startsWith("Spawned a commander session") === true,
        ),
      ).toBe(true);
    }, settle);
    await vi.waitFor(() => {
      expect(
        hub.logs.some((line) => line.includes("Another waiter is dispatching")),
      ).toBe(true);
    }, settle);

    const [call] = spawns.calls;
    if (call === undefined) throw new Error("one spawn");
    expect(call.request).toMatchObject({
      provider: "claude-code",
      machine: null,
      repoMain: REPO.repoMain,
      repoTop: REPO.repoTop,
      root: REPO.root,
      safe: false,
      sendMessage: true,
      argv: null,
      tab: `${id} commander`,
    });
    expect(call.request.message).toContain(
      `You are the incident commander for ${id}: Storage is read-only.`,
    );
    expect(call.request.message).toContain(
      `toolkit incident claim ${id} --dispatch-token ${call.token}`,
    );
    expect(call.request.message).toContain("load the incident-response skill");
    expect(call.request.message).toContain("toolkit incident update");
    expect(call.request.message).toContain("https://github.com/o/r/pull/5150");
    const detail = await hub.api.byRef(id);
    expect(detail.command.state).toBe("dispatching");
    expect(JSON.stringify(detail)).not.toContain(call.token);
    expect(hub.logs.join("\n")).not.toContain(call.token);

    // The spawned session redeems the token; then resolves with evidence.
    const commander = agentActor("commander");
    await hub.api.claimDispatch({
      actor: commander,
      ref: id,
      dispatchToken: call.token,
    });
    const owned = await hub.api.byRef(id);
    expect(owned.command.commander?.key).toBe(commander.key);
    await hub.api.resolve({
      actor: commander,
      ref: id,
      expectedRevision: owned.revision,
      note: "Writes succeed again.",
    });
    const [resultA, resultB] = await Promise.all([waitA, waitB]);
    expect([resultA.outcome, resultB.outcome]).toEqual([
      "resolved",
      "resolved",
    ]);
    expect(resultA.dispatches.length + resultB.dispatches.length).toBe(1);
    expect(JSON.stringify([resultA, resultB])).not.toContain(call.token);
  });

  test("a failed spawn releases the lease and another waiter dispatches", async () => {
    const hub = await newHub();
    const incident = await hub.declare({ systems: ["storage"] });
    const id = incident.identifier;
    const spawns = fakeSpawns([
      { ok: false, error: "herdr-app is not running" },
    ]);
    const [a, b] = [agentActor("a"), agentActor("b")];
    const waitA = startWaiter(hub, a, spawns.spawnerFor("a"), { ref: id });
    const waitB = startWaiter(hub, b, spawns.spawnerFor("b"), { ref: id });
    await vi.waitFor(async () => {
      expect(await affectedKeys(hub, id)).toHaveLength(2);
      expect(hub.scheduler.pending()).toBeGreaterThanOrEqual(2);
    }, settle);

    hub.scheduler.advance(GRACE_MS);
    await vi.waitFor(async () => {
      expect(spawns.calls).toHaveLength(2);
      expect(await commandStateOf(hub, id)).toBe("dispatching");
    }, settle);
    const [failed, retried] = spawns.calls;
    expect(failed?.waiter).not.toBe(retried?.waiter);
    expect(failed?.token).not.toBe(retried?.token);
    const timeline = await timelineOf(hub, id);
    expect(timeline.find((event) => event.type === "released")?.body).toBe(
      "Spawn failed: herdr-app is not running",
    );

    const commander = agentActor("commander");
    await hub.api.claimDispatch({
      actor: commander,
      ref: id,
      dispatchToken: retried?.token ?? "",
    });
    const owned = await hub.api.byRef(id);
    await hub.api.resolve({
      actor: commander,
      ref: id,
      expectedRevision: owned.revision,
      note: "Fixed.",
    });
    const results = await Promise.all([waitA, waitB]);
    expect(
      results
        .flatMap((item) => item.dispatches)
        .map((item) => item.outcome)
        .toSorted(),
    ).toEqual(["spawn-failed", "spawned"]);
  });

  test("a lapsed lease lets a waiter dispatch again", async () => {
    const hub = await newHub({ dispatchLeaseSeconds: 300 });
    const incident = await hub.declare({ systems: ["storage"] });
    const id = incident.identifier;
    const spawns = fakeSpawns();
    const waiter = agentActor("a");
    const waiting = startWaiter(hub, waiter, spawns.spawnerFor("a"), {
      ref: id,
      timeoutMs: 3_600_000,
    });
    await vi.waitFor(async () => {
      expect(await affectedKeys(hub, id)).toHaveLength(1);
    }, settle);

    hub.scheduler.advance(GRACE_MS);
    await vi.waitFor(() => {
      expect(spawns.calls).toHaveLength(1);
    }, settle);
    // Nobody claims. The lease lapses without a frame; the waiter's timer notices.
    await vi.waitFor(async () => {
      expect(await commandStateOf(hub, id)).toBe("dispatching");
      expect(hub.scheduler.pending()).toBeGreaterThanOrEqual(2);
    }, settle);
    hub.scheduler.advance(300_000);
    await vi.waitFor(() => {
      expect(spawns.calls).toHaveLength(2);
    }, settle);
    expect(spawns.calls[0]?.token).not.toBe(spawns.calls[1]?.token);
    const timeline = await timelineOf(hub, id);
    expect(timeline.map((event) => event.type)).toContain("dispatch-expired");

    hub.scheduler.advance(3_600_000);
    await expect(waiting).resolves.toMatchObject({ outcome: "timeout" });
  });
});

describe("toolkit incident wait fallbacks", () => {
  test("--no-spawn takes command directly once the grace passes", async () => {
    const hub = await newHub();
    const incident = await hub.declare({ systems: ["storage"] });
    const spawns = fakeSpawns();
    const waiter = agentActor("a");
    const waiting = startWaiter(hub, waiter, spawns.spawnerFor("a"), {
      ref: incident.identifier,
      spawn: false,
    });
    await vi.waitFor(async () => {
      expect(await affectedKeys(hub, incident.identifier)).toHaveLength(1);
      expect(hub.scheduler.pending()).toBeGreaterThanOrEqual(1);
    }, settle);
    hub.scheduler.advance(GRACE_MS);
    await expect(waiting).resolves.toMatchObject({
      outcome: "commander",
      via: "took",
      incident: { command: { state: "owned", commander: { key: waiter.key } } },
    });
    expect(spawns.calls).toEqual([]);
  });

  test("maintenance is waited on but never taken over or dispatched", async () => {
    const hub = await newHub();
    const declarer = agentActor("declarer");
    const window = await hub.declare({
      kind: "maintenance",
      systems: ["storage"],
      title: "Storage firmware upgrade",
      scheduledStart: new Date(hub.scheduler.now()).toISOString(),
      scheduledEnd: new Date(hub.scheduler.now() + 3_600_000).toISOString(),
    });
    const started = await hub.api.changeStatus({
      actor: declarer,
      ref: window.identifier,
      expectedRevision: window.revision,
      status: "in_progress",
    });
    const spawns = fakeSpawns();
    const waiting = startWaiter(hub, agentActor("a"), spawns.spawnerFor("a"), {
      ref: window.identifier,
    });
    await vi.waitFor(async () => {
      expect(await affectedKeys(hub, window.identifier)).toHaveLength(1);
    }, settle);
    hub.scheduler.advance(GRACE_MS);
    // Give the waiter time to react to the grace timer, were it to take over.
    await Bun.sleep(300);
    const detail = await hub.api.byRef(window.identifier);
    expect(detail.command.state).toBe("none");
    expect(spawns.calls).toEqual([]);
    await hub.api.resolve({
      actor: declarer,
      ref: window.identifier,
      expectedRevision: detail.revision,
      note: "Firmware upgraded; writes verified.",
      force: true,
    });
    await expect(waiting).resolves.toMatchObject({
      outcome: "resolved",
      incident: { kind: "maintenance", status: "completed" },
      dispatches: [],
    });
    expect(spawns.calls).toEqual([]);
    expect(started.status).toBe("in_progress");
  });

  test("spawning disabled by flag falls back to taking command", async () => {
    const hub = await newHub();
    // The fixture seeds a dispatch lease, so the flag goes off after startup.
    hub.hub.settings.current = {
      ...hub.hub.settings.current,
      takeoverSpawnEnabled: false,
    };
    const incident = await hub.declare({ systems: ["storage"] });
    const spawns = fakeSpawns();
    const waiting = startWaiter(hub, agentActor("a"), spawns.spawnerFor("a"), {
      ref: incident.identifier,
    });
    await vi.waitFor(() => {
      expect(hub.scheduler.pending()).toBeGreaterThanOrEqual(1);
    }, settle);
    hub.scheduler.advance(GRACE_MS);
    await expect(waiting).resolves.toMatchObject({
      outcome: "commander",
      via: "took",
    });
    expect(spawns.calls).toEqual([]);
  });

  test("a dropped stream reconnects with backoff and refetches what it missed", async () => {
    const hub = await newHub();
    const incident = await hub.declare({
      systems: ["storage"],
      takeCommand: true,
    });
    const connections: string[] = [];
    // Fake SSE: the first connection fails; the second opens and stays open.
    const stream: IncidentStream = (identifier, signal, handlers) => {
      connections.push(identifier ?? "*");
      if (connections.length === 1)
        return Promise.reject(new Error("ECONNRESET"));
      handlers.onOpen();
      return new Promise((resolve) => {
        signal.addEventListener("abort", () => {
          resolve();
        });
      });
    };
    const waiter = agentActor("a");
    const waiting = waitForIncident(
      { ...hub.deps(waiter, fakeSpawns().spawnerFor("a")), stream },
      { ref: incident.identifier, spawn: true },
    );
    await vi.waitFor(() => {
      expect(connections).toHaveLength(1);
      expect(hub.logs.some((line) => line.includes("ECONNRESET"))).toBe(true);
    }, settle);
    const current = await hub.api.byRef(incident.identifier);
    await hub.api.resolve({
      actor: agentActor("declarer"),
      ref: incident.identifier,
      expectedRevision: current.revision,
      note: "Fixed while the waiter was disconnected.",
    });
    hub.scheduler.advance(1000);
    await expect(waiting).resolves.toMatchObject({ outcome: "resolved" });
    expect(connections).toEqual([incident.identifier, incident.identifier]);
  });
});
