import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BridgeClient } from "#bridge/client.ts";
import { type DaemonContext, routeRequest } from "#daemon/router.ts";
import type { Box, Player } from "#protocol/bridge.ts";
import { type LiveWriteFlags, liveWriteHeaders } from "#protocol/live.ts";
import type { KubectlRunner } from "#providers/kubernetes/kubectl.ts";
import { LiveJournal } from "#src/live/journal.ts";
import {
  liveContext,
  liveFixture,
  LIVE_TEST_TOKEN,
  statefulSetFixture,
} from "./live-harness.ts";

const sts = await statefulSetFixture();
const pod = await liveFixture("pod.json");
const backups = await liveFixture("backups.json");

/** A bridge that records calls; the live service builds it for the forwarded port. */
class FakeLiveBridge extends BridgeClient {
  calls: string[] = [];
  humans: Player[] = [];
  snapshots: { id: string; box: Box }[] = [];
  constructor() {
    super({ baseUrl: "http://unused", token: "unused" });
  }
  override health() {
    return Promise.resolve({
      ok: true as const,
      apiVersion: 1,
      bridgeVersion: "test",
    });
  }
  override players() {
    return Promise.resolve({ players: this.humans });
  }
  override command(command: string) {
    this.calls.push(`command:${command}`);
    return Promise.resolve({ success: true, output: ["ok"] });
  }
  override weRun(request: { ops: readonly { command: string }[] }) {
    this.calls.push(`we:${request.ops.map((op) => op.command).join(",")}`);
    return Promise.resolve({
      results: request.ops.map((op) => ({
        command: op.command,
        ok: true,
        changed: 1,
        messages: [],
        errors: [],
      })),
      historySize: 1,
    });
  }
  override snapshotCreate(box: Box, label?: string) {
    const id = `snap-${this.snapshots.length.toString()}`;
    this.snapshots.push({ id, box });
    this.calls.push(`snapshot:${label ?? ""}`);
    return Promise.resolve({
      id,
      box,
      ...(label === undefined ? {} : { label }),
      createdAt: "2026-10-04T20:00:00Z",
      bytes: 10,
      sha256: "0".repeat(64),
    });
  }
  override snapshotRestore(id: string) {
    this.calls.push(`restore:${id}`);
    return Promise.resolve({ changed: 25 });
  }
  override events() {
    return Promise.resolve({
      cursor: 3,
      truncated: false,
      events: [
        { seq: 1, ts: "t", type: "log" as const, text: "Done (10s)!" },
        { seq: 2, ts: "t", type: "chat" as const, player: "Steve", text: "hi" },
        { seq: 3, ts: "t", type: "log" as const, text: "Steve joined" },
      ],
    });
  }
}

type Cluster = {
  sts: unknown;
  pod: unknown;
  backups: unknown;
  calls: string[][];
};

function clusterRunner(cluster: Cluster): KubectlRunner {
  return (args) => {
    cluster.calls.push([...args]);
    const [verb, kind] = args.slice(5);
    if (verb === "get" && kind === "statefulset") {
      return Promise.resolve({
        stdout: JSON.stringify(cluster.sts),
        stderr: "",
      });
    }
    if (verb === "get" && kind === "pod") {
      return cluster.pod === null
        ? Promise.reject(
            new Error(
              'Error from server (NotFound): pods "minecraft-tsmc-0" not found',
            ),
          )
        : Promise.resolve({ stdout: JSON.stringify(cluster.pod), stderr: "" });
    }
    if (verb === "get" && kind === "backups.velero.io") {
      return Promise.resolve({
        stdout: JSON.stringify(cluster.backups),
        stderr: "",
      });
    }
    return verb === "create"
      ? Promise.resolve({ stdout: "created", stderr: "" })
      : Promise.reject(new Error(`unexpected kubectl ${args.join(" ")}`));
  };
}

async function setup(
  options: { token?: string; cluster?: Partial<Omit<Cluster, "calls">> } = {},
) {
  const cluster: Cluster = { sts, pod, backups, calls: [], ...options.cluster };
  const bridge = new FakeLiveBridge();
  const journal = new LiveJournal(
    await mkdtemp(path.join(os.tmpdir(), "live-svc-")),
  );
  const { ctx } = liveContext({
    runner: clusterRunner(cluster),
    bridge,
    journal,
    ...(options.token === undefined ? {} : { token: options.token }),
    now: () => new Date("2026-10-04T20:00:00Z"),
  });
  return { cluster, bridge, ctx, journal };
}

const JsonObjectSchema = z.record(z.string(), z.unknown());

async function send(
  ctx: DaemonContext,
  request: {
    method: string;
    route: string;
    body?: unknown;
    flags?: LiveWriteFlags;
  },
): Promise<{ status: number; json: Record<string, unknown> }> {
  const url = new URL(`http://daemon${request.route}`);
  const response = await routeRequest(
    ctx,
    url,
    new Request(url.toString(), {
      method: request.method,
      headers: {
        "content-type": "application/json",
        ...liveWriteHeaders(request.flags ?? {}),
      },
      ...(request.body === undefined
        ? {}
        : { body: JSON.stringify(request.body) }),
    }),
  );
  return {
    status: response.status,
    json: JsonObjectSchema.parse(await response.json()),
  };
}

function get(ctx: DaemonContext, route: string) {
  return send(ctx, { method: "GET", route });
}

function post(
  ctx: DaemonContext,
  route: string,
  body: unknown,
  flags: LiveWriteFlags = {},
) {
  return send(ctx, { method: "POST", route, body, flags });
}

const setStone = {
  session: "agent",
  world: "world",
  ops: [
    {
      command: "//set stone",
      pos1: { x: 0, y: 60, z: 0 },
      pos2: { x: 4, y: 64, z: 4 },
    },
  ],
};

describe("live target reads", () => {
  it("reports cluster status without exposing the token", async () => {
    const { ctx } = await setup();
    const { status, json } = await get(ctx, "/live/status");
    expect(status).toBe(200);
    expect(json).toMatchObject({
      replicas: 1,
      podReady: true,
      tokenConfigured: true,
      refusal: null,
    });
    expect(JSON.stringify(json)).not.toContain(LIVE_TEST_TOKEN);
  });

  it("impersonates the scoped ServiceAccount in minecraft-tsmc", async () => {
    const { ctx, cluster } = await setup();
    await get(ctx, "/live/status");
    expect(cluster.calls[0]?.slice(0, 5)).toEqual([
      "--context",
      "ctx",
      "--as=system:serviceaccount:mc-sandbox:mc-harness",
      "-n",
      "minecraft-tsmc",
    ]);
  });

  it("passes reads through without a reason", async () => {
    const { ctx, bridge } = await setup();
    const { status } = await post(ctx, "/targets/live/command", {
      command: "list",
    });
    expect(status).toBe(200);
    expect(bridge.calls).toEqual(["command:list"]);
  });

  it("tails logs from the bridge's captured log events", async () => {
    const { ctx } = await setup();
    const { json } = await get(ctx, "/targets/live/logs?lines=5");
    expect(json).toEqual({ lines: ["Done (10s)!", "Steve joined"] });
  });

  it("refuses everything while asleep or held by the mining reset", async () => {
    const asleep = {
      ...sts,
      spec: { ...sts.spec, replicas: 0 },
      status: { readyReplicas: 0 },
    };
    const sleeping = await setup({ cluster: { sts: asleep, pod: null } });
    const read = await get(sleeping.ctx, "/targets/live/players");
    expect(read.status).toBe(409);
    expect(String(read.json["error"])).toMatch(/asleep/u);

    const locked = {
      ...sts,
      metadata: {
        ...sts.metadata,
        annotations: {
          ...sts.metadata.annotations,
          "sjer.red/mining-reset-lock": "2026q4",
        },
      },
    };
    const held = await setup({ cluster: { sts: locked } });
    const write = await post(held.ctx, "/targets/live/we", setStone, {
      reason: "x",
    });
    expect(write.status).toBe(409);
    expect(String(write.json["error"])).toMatch(/mining reset/u);
  });

  it("explains how to supply the token when the daemon has none", async () => {
    const { ctx } = await setup({ token: "" });
    const { status, json } = await get(ctx, "/targets/live/info");
    expect(status).toBe(412);
    expect(String(json["error"])).toContain("op read 'op://");
  });

  it("rechecks restoration leases before file reads despite cached ready status", async () => {
    const { ctx, cluster, bridge } = await setup();
    await expect(ctx.files("live")).resolves.toBeDefined();
    cluster.sts = {
      ...sts,
      metadata: {
        ...sts.metadata,
        annotations: {
          ...sts.metadata.annotations,
          "sjer.red/world-restore-lease": "restore-test",
        },
      },
    };
    await expect(ctx.files("live")).rejects.toThrow(
      /world restoration.*restore-test/u,
    );
    const { status, json } = await get(ctx, "/files/live/ls?path=world");
    expect(status).toBe(409);
    expect(String(json["error"])).toMatch(/world restoration/u);
    expect(bridge.calls).toEqual([]);
    expect(cluster.calls.every((args) => args[5] === "get")).toBe(true);
  });

  it("permits file reads during a mining reset without a restoration lease", async () => {
    const { ctx } = await setup({
      cluster: {
        sts: {
          ...sts,
          metadata: {
            ...sts.metadata,
            annotations: {
              ...sts.metadata.annotations,
              "sjer.red/mining-reset-lock": "2026q4",
            },
          },
        },
      },
    });
    await expect(ctx.files("live")).resolves.toBeDefined();
  });
});

describe("live target writes", () => {
  it("refuses writes without a reason and journals nothing", async () => {
    const { ctx, bridge, journal } = await setup();
    const { status, json } = await post(ctx, "/targets/live/command", {
      command: "time set day",
    });
    expect(status).toBe(403);
    expect(String(json["error"])).toMatch(/--reason/u);
    expect(bridge.calls).toEqual([]);
    expect(await journal.list()).toEqual([]);
  });

  it("journals a tier-0 write with its reason", async () => {
    const { ctx, journal } = await setup();
    const { status } = await post(
      ctx,
      "/targets/live/command",
      { command: "time set day" },
      { reason: "screenshots" },
    );
    expect(status).toBe(200);
    const [entry] = await journal.list();
    expect(entry).toMatchObject({
      kind: "write",
      reason: "screenshots",
      tier: 0,
      result: "ok",
      snapshotId: null,
    });
  });

  it("snapshots before a block write and undoes it", async () => {
    const { ctx, bridge, journal } = await setup();
    const write = await post(ctx, "/targets/live/we", setStone, {
      reason: "test pad",
    });
    expect(write.status).toBe(200);
    expect(bridge.calls).toEqual(["snapshot:live-undo", "we://set stone"]);
    const [entry] = await journal.list();
    expect(entry).toMatchObject({
      tier: 1,
      snapshotId: "snap-0",
      box: { world: "world", min: { x: 0, y: 60, z: 0 } },
    });
    const undo = await post(ctx, "/live/undo", {
      id: entry?.id,
      reason: "revert test pad",
    });
    expect(undo.status).toBe(200);
    expect(undo.json).toMatchObject({
      changed: 25,
      entry: { kind: "undo", undoes: entry?.id },
    });
    expect(bridge.calls.at(-1)).toBe("restore:snap-0");
    const again = await post(ctx, "/live/undo", {
      id: entry?.id,
      reason: "again",
    });
    expect(again.status).toBe(409);
    expect(String(again.json["error"])).toMatch(/already undone/u);
  });

  it("undoes a tier-2 region write without asking for another backup", async () => {
    const { ctx, journal } = await setup();
    const wide = {
      ...setStone,
      ops: [{ ...setStone.ops[0], pos2: { x: 20, y: 64, z: 20 } }],
    };
    const write = await post(ctx, "/targets/live/we", wide, {
      reason: "clear the field",
    });
    expect(write.status).toBe(200);
    const [entry] = await journal.list();
    expect(entry).toMatchObject({ tier: 2, snapshotId: "snap-0" });
    const undo = await post(ctx, "/live/undo", {
      id: entry?.id,
      reason: "put the field back",
    });
    expect(undo.status).toBe(200);
  });

  it("refuses a block write while a human stands inside the box", async () => {
    const { ctx, bridge } = await setup();
    bridge.humans = [
      {
        name: "Steve",
        uuid: "u",
        world: "world",
        pos: { x: 2, y: 62, z: 2 },
        gameMode: "SURVIVAL",
        npc: false,
      },
    ];
    const { status, json } = await post(ctx, "/targets/live/we", setStone, {
      reason: "x",
    });
    expect(status).toBe(403);
    expect(String(json["error"])).toMatch(/Steve is inside/u);
    expect(bridge.calls).toEqual([]);
  });

  it("gates dangerous commands on confirmation and a fresh backup", async () => {
    const { ctx, bridge, journal } = await setup();
    const unconfirmed = await post(
      ctx,
      "/targets/live/command",
      { command: "kill @e" },
      { reason: "cleanup" },
    );
    expect(unconfirmed.status).toBe(403);
    const ok = await post(
      ctx,
      "/targets/live/command",
      { command: "kill @e[type=item]" },
      { reason: "cleanup", confirmDangerous: true },
    );
    expect(ok.status).toBe(200);
    expect(bridge.calls).toEqual(["command:kill @e[type=item]"]);
    const [entry] = await journal.list();
    expect(entry).toMatchObject({
      tier: 2,
      backup: { name: "6hourly-backup-20261004181530" },
    });
  });

  it("refuses dangerous commands when no backup is recent", async () => {
    const { ctx } = await setup({ cluster: { backups: { items: [] } } });
    const { status, json } = await post(
      ctx,
      "/targets/live/command",
      { command: "stop" },
      { reason: "maintenance", confirmDangerous: true },
    );
    expect(status).toBe(403);
    expect(String(json["error"])).toMatch(/live backup --wait/u);
  });
});

describe("live backups and journal", () => {
  it("starts a Velero backup with the harness manifest", async () => {
    const { ctx, cluster, journal } = await setup();
    const { status, json } = await post(ctx, "/live/backup", {
      reason: "before regen",
      wait: false,
    });
    expect(status).toBe(200);
    expect(json).toMatchObject({
      name: "mc-harness-20261004t200000z",
      phase: "New",
      completedAt: null,
    });
    const create = cluster.calls.find((args) => args.includes("create"));
    expect(create?.slice(0, 5)).toEqual([
      "--context",
      "ctx",
      "--as=system:serviceaccount:mc-sandbox:mc-harness",
      "-n",
      "velero",
    ]);
    const [entry] = await journal.list();
    expect(entry).toMatchObject({ kind: "backup", reason: "before regen" });
  });

  it("lists the journal since a time", async () => {
    const { ctx } = await setup();
    await post(
      ctx,
      "/targets/live/command",
      { command: "time set day" },
      { reason: "a" },
    );
    const { json } = await get(ctx, "/live/journal?since=2026-10-04T00:00:00Z");
    expect(json["entries"]).toHaveLength(1);
    const bad = await get(ctx, "/live/journal?since=nope");
    expect(bad.status).toBe(400);
  });
});
