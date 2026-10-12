import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gridFromRegionRead } from "@shepherdjerred/mc-build/core/grid.ts";
import { writeSchematic } from "@shepherdjerred/mc-build/core/schem.ts";
import { gridHash } from "@shepherdjerred/mc-build/core/site.ts";
import { BridgeClient } from "#bridge/client.ts";
import { promoteBuild, undoApply } from "#build/apply.ts";
import type { Env } from "#build/helpers.ts";
import { DaemonClient } from "#build/daemon-client.ts";
import { Journal } from "#build/journal.ts";
import { BuildWorkspace } from "#build/workspace.ts";
import { routeRequest } from "#daemon/router.ts";
import type { Box, RegionReadResponse } from "#protocol/bridge.ts";
import { BUILD_FILES } from "#protocol/build.ts";
import type { LiveWriteFlags } from "#protocol/live.ts";
import type { KubectlRunner } from "#providers/kubernetes/kubectl.ts";
import { LiveJournal } from "#src/live/journal.ts";
import { liveConfig, liveContext, liveFixture } from "./live-harness.ts";

const sts = await liveFixture("statefulset.json");
const pod = await liveFixture("pod.json");

const site: Box = {
  world: "world",
  min: { x: 100, y: 64, z: 100 },
  max: { x: 101, y: 64, z: 101 },
};

function region(state: string): RegionReadResponse {
  const indices = new Uint32Array(4);
  return {
    world: site.world,
    min: site.min,
    max: site.max,
    size: { x: 2, y: 1, z: 2 },
    palette: [state],
    blocks: Buffer.from(indices.buffer).toString("base64"),
    blockEntities: [],
  };
}

const grass = region("minecraft:grass_block[snowy=false]");
const stone = region("minecraft:stone");

/** A live server whose 2x1x2 site turns to stone when pasted and back on restore. */
class FakeServer extends BridgeClient {
  current = grass;
  pasted: Box[] = [];
  snapshots = new Map<string, RegionReadResponse>();
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
    return Promise.resolve({ players: [] });
  }
  override regionRead() {
    return Promise.resolve(this.current);
  }
  override snapshotCreate(box: Box, label?: string) {
    const id = `snap-${this.snapshots.size.toString()}`;
    this.snapshots.set(id, this.current);
    return Promise.resolve({
      id,
      box,
      ...(label === undefined ? {} : { label }),
      createdAt: "2026-10-04T20:00:00Z",
      bytes: 1,
      sha256: "0".repeat(64),
    });
  }
  override snapshotRestore(id: string) {
    const saved = this.snapshots.get(id);
    if (saved === undefined) {
      return Promise.reject(new Error(`no ${id}`));
    }
    this.current = saved;
    return Promise.resolve({ changed: 4 });
  }
  override snapshotList() {
    return Promise.resolve({
      snapshots: [...this.snapshots.keys()].map((id) => ({
        id,
        box: site,
        createdAt: "2026-10-04T20:00:00Z",
        bytes: 1,
        sha256: "0".repeat(64),
      })),
    });
  }
  override wePaste(request: { at: Box["min"] }) {
    this.pasted.push({ world: site.world, min: request.at, max: site.max });
    this.current = stone;
    return Promise.resolve({
      changed: 4,
      min: site.min,
      max: site.max,
      historySize: 1,
    });
  }
}

const runner: KubectlRunner = (args) => {
  const [verb, kind] = args.slice(5);
  if (verb === "get" && kind === "statefulset") {
    return Promise.resolve({ stdout: JSON.stringify(sts), stderr: "" });
  }
  return verb === "get" && kind === "pod"
    ? Promise.resolve({ stdout: JSON.stringify(pod), stderr: "" })
    : Promise.reject(new Error(`unexpected kubectl ${args.join(" ")}`));
};

function ignoreLog(): void {
  // Build progress lines are not asserted.
}

const servers: ReturnType<typeof Bun.serve>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop(true)));
});

async function writeBuild(dir: string): Promise<void> {
  const workspace = new BuildWorkspace(dir);
  await workspace.writeManifest({
    version: 1,
    name: "pad",
    world: site.world,
    anchor: site.min,
    seed: 1,
    site: {
      min: site.min,
      max: site.max,
      siteHash: gridHash(gridFromRegionRead(grass)),
    },
  });
  await workspace.writeOplog({ version: 1, ops: [] });
  await workspace.writeExpected(stone);
  await Bun.write(
    workspace.file(BUILD_FILES.expectedSchematic),
    writeSchematic(gridFromRegionRead(stone), 4903),
  );
}

/** A real daemon socket serving the live target, and a build directory to promote. */
async function setup() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "live-promote-"));
  const server = new FakeServer();
  const liveJournal = new LiveJournal(path.join(tmp, "live-journal"));
  const { ctx } = liveContext({
    runner,
    bridge: server,
    journal: liveJournal,
    config: { ...liveConfig, worlds: ["world"] },
  });
  const socket = path.join(tmp, "daemon.sock");
  servers.push(
    Bun.serve({
      unix: socket,
      fetch: (request) => routeRequest(ctx, new URL(request.url), request),
    }),
  );
  const dir = path.join(tmp, "build");
  await writeBuild(dir);
  const journal = new Journal(path.join(tmp, "build-journal"));
  const env = (flags: LiveWriteFlags = {}): Env => ({
    client: new DaemonClient(socket, flags),
    journal,
    log: ignoreLog,
  });
  return { dir, server, liveJournal, env };
}

describe("build promote --target live", () => {
  it("needs a reason, then pastes through the guard, verifies and undoes", async () => {
    const { dir, server, liveJournal, env } = await setup();

    const plan = await promoteBuild(env(), dir, { target: "live" });
    expect(plan).toMatchObject({ target: "live", changes: 4, applied: null });

    await expect(
      promoteBuild(env(), dir, { target: "live", confirm: plan.planHash }),
    ).rejects.toThrow(/live write refused: .*--reason/u);
    expect(server.pasted).toEqual([]);

    const reasoned = env({ reason: "promote pad" });
    const applied = await promoteBuild(reasoned, dir, {
      target: "live",
      confirm: plan.planHash,
    });
    expect(applied.applied?.status).toBe("verified");
    expect(server.pasted).toEqual([site]);
    const entries = await liveJournal.list();
    const writes = entries.filter((entry) => entry.kind === "write");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      reason: "promote pad",
      tier: 1,
      box: site,
      result: "ok",
    });

    const undone = await undoApply(reasoned, applied.applied?.applyId ?? "");
    expect(undone.restoredToSite).toBe(true);
    expect(server.current).toBe(grass);
  });
});
