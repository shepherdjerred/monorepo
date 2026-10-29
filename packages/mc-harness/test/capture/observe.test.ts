import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it, expect } from "vitest";
import { z } from "zod";
import { observeCurrent } from "#src/capture/observe.ts";
import { RunSchema } from "#src/capture/model.ts";
import { CaptureTransport } from "#src/capture/transport.ts";

const uuid = "00000000-0000-4000-8000-000000000001";
class ObservationTransport extends CaptureTransport {
  readonly calls: string[] = [];
  frames = 0;
  mapKind = "real-map";
  mismatched = false;
  recording = false;
  started = false;
  receipt = "";
  override world<T extends z.ZodType>(
    schema: T,
    action: string,
  ): Promise<z.infer<T>> {
    this.calls.push(`world:${action}`);
    const values: Record<string, unknown> = {
      info: {
        apiVersion: 1,
        bridgeVersion: "old",
        minecraftVersion: "26.3",
        serverVersion: "Paper",
        dataVersion: 5023,
        onlineMode: false,
        worlds: [
          {
            name: "world",
            key: "minecraft:overworld",
            environment: "NORMAL",
            minY: -64,
            maxY: 319,
          },
        ],
        plugins: [],
        capabilities: [],
      },
      players: {
        players: [
          {
            name: "XiguaJerred",
            uuid: this.mismatched ? "wrong" : uuid,
            world: "world",
            pos: { x: 0, y: 64, z: 0 },
            gameMode: "SURVIVAL",
            npc: false,
          },
        ],
      },
    };
    if (!(action in values))
      throw new Error(`Unexpected world operation ${action}`);
    return Promise.resolve(schema.parse(values[action]));
  }
  override async request<T extends z.ZodType>(
    schema: T,
    method: string,
    route: string,
    body?: unknown,
  ): Promise<z.infer<T>> {
    this.calls.push(`${method}:${route}`);
    if (method === "POST" && this.recording && route.includes("/record-")) {
      if (route.endsWith("/record-start")) this.started = true;
      return schema.parse({
        detail: "native recorder fixture",
        result: {
          state: this.started ? "COMPLETE" : "READY",
          error: "",
          receipt: this.receipt,
        },
      });
    }
    if (method === "POST" && route.endsWith("/capture")) {
      const { out } = z.object({ out: z.string() }).parse(body);
      await Bun.write(out, "native frame fixture");
      return schema.parse({ path: out });
    }
    if (route === "/sandboxes")
      return schema.parse({
        sandboxes: [
          {
            id: this.target,
            provider: "docker",
            profile: "storm-dev",
            world: this.mapKind,
            mapSource: { sha256: "a".repeat(64), files: 10, bytes: 1000 },
            status: "ready",
            createdAt: "now",
            expiresAt: "later",
            keep: false,
            bootMs: 1,
            endpoints: {
              game: { host: "127.0.0.1", port: 1 },
              rcon: { host: "127.0.0.1", port: 2 },
              bridge: { host: "127.0.0.1", port: 3 },
            },
          },
        ],
      });
    if (method !== "GET")
      throw new Error("Observation attempted an interaction");
    this.frames += 4;
    return schema.parse({
      client: {
        name: "XiguaJerred",
        target: this.target,
        server: "fixture",
        pid: 1,
        startedAt: "now",
        artifacts: "private",
      },
      state: {
        connected: true,
        name: "XiguaJerred",
        uuid,
        renderedFrames: this.frames,
        terrainReady: this.frames >= 12,
        position: [0, 64, 0],
        yaw: 0,
        pitch: 0,
        health: 20,
        food: 20,
        world: "minecraft:overworld",
        hotbar: 0,
        screen: "Guide",
        target: { kind: "miss" },
        fps: 60,
        heldInputs: [],
        pid: 1,
        inventory: [],
      },
    });
  }
}

async function fixture(root: string, target: string) {
  const scene = path.join(root, "input.json");
  await Bun.write(
    scene,
    JSON.stringify({
      schema: 1,
      name: "observed-guide",
      alt: "The actual guide",
      caption: "",
      annotations: [],
    }),
  );
  return RunSchema.parse({
    schema: 1,
    id: "capture-test",
    mode: "observation",
    target,
    name: "XiguaJerred",
    reason: "test",
    inspectors: [],
    server: null,
    baseline: null,
    scene,
    sceneHash: "hash",
    box: {
      world: "pending",
      min: { x: 0, y: 64, z: 0 },
      max: { x: 0, y: 64, z: 0 },
    },
    anchor: [0, 64, 0],
    state: "preflight",
    checkpoint: null,
    snapshot: null,
    inspection: null,
    origin: null,
    staging: null,
    cleanup: [],
    captures: [],
    error: "",
  });
}

it("observes an old live bridge without world writes, inventory changes, or closing its screen", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "capture-observe-"));
  try {
    const run = await fixture(root, "live");
    const transport = new ObservationTransport("live", "test");
    await observeCurrent(root, run, transport);
    expect(run.captures.map((capture) => capture.name)).toEqual([
      "observed-guide",
    ]);
    expect(run.checkpoint).toBeNull();
    expect(transport.frames).toBeGreaterThanOrEqual(16);
    expect(transport.calls.filter((call) => call.startsWith("world:"))).toEqual(
      ["world:info", "world:players"],
    );
    expect(transport.calls.filter((call) => call.startsWith("POST:"))).toEqual([
      "POST:/clients/XiguaJerred/capture",
    ]);
    expect(
      JSON.parse(await Bun.file(path.join(root, "observation.json")).text())
        .after.screen,
    ).toBe("Guide");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("refuses mismatched identities and synthetic local worlds before taking a frame", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "capture-observe-refuse-"));
  try {
    const live = new ObservationTransport("live", "test");
    live.mismatched = true;
    await expect(
      observeCurrent(root, await fixture(root, "live"), live),
    ).rejects.toThrow("identity");
    expect(live.calls.some((call) => call.startsWith("POST:"))).toBe(false);
    const local = new ObservationTransport("sbx-123abc", "test");
    local.mapKind = "void";
    await expect(
      observeCurrent(root, await fixture(root, local.target), local),
    ).rejects.toThrow("real-map");
    expect(local.calls.some((call) => call.startsWith("POST:"))).toBe(false);
    local.mapKind = "real-map";
    const run = await fixture(root, local.target);
    await observeCurrent(root, run, local);
    expect(run.mapSource?.sha256).toBe("a".repeat(64));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("records the existing view with native controls and ordinary read-only world admission", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "capture-observe-video-"));
  try {
    const transport = new ObservationTransport("live", "test");
    transport.recording = true;
    transport.receipt = path.join(root, "native-frames.json");
    await Bun.write(
      transport.receipt,
      "opaque native receipt; validated by the renderer",
    );
    const run = await fixture(root, "live");
    await observeCurrent(root, run, transport, 3);
    expect(run.captures[0]?.source).toBe(transport.receipt);
    expect(transport.calls.filter((call) => call.startsWith("world:"))).toEqual(
      ["world:info", "world:players"],
    );
    expect(transport.calls.filter((call) => call.startsWith("POST:"))).toEqual([
      "POST:/clients/XiguaJerred/record-arm",
      "POST:/clients/XiguaJerred/record-status",
      "POST:/clients/XiguaJerred/record-start",
      "POST:/clients/XiguaJerred/record-marker",
      "POST:/clients/XiguaJerred/record-marker",
      "POST:/clients/XiguaJerred/record-status",
      "POST:/clients/XiguaJerred/record-cancel",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
