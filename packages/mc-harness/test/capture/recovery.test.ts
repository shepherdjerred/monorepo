import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import type { z } from "zod";
import { restoreScene } from "#src/capture/recovery.ts";
import {
  initializeRun,
  RunSchema,
  type CaptureRun,
} from "#src/capture/model.ts";
import { regionFingerprint } from "#src/capture/admission.ts";
import { CaptureTransport } from "#src/capture/transport.ts";
import type { CaptureScene } from "#src/capture/define.ts";
import { assertNoPendingRun } from "#src/capture/pending.ts";

const box = {
  world: "world",
  min: { x: 0, y: 63, z: 0 },
  max: { x: 0, y: 63, z: 0 },
};
const terrain = {
  ...box,
  size: { x: 1, y: 1, z: 1 },
  palette: ["minecraft:stone"],
  blocks: Buffer.alloc(4).toString("base64"),
  blockEntities: [],
};
const checkpoint = {
  moduleState: { "track.mechanic": "1" },
  uuid: "00000000-0000-4000-8000-000000000001",
  name: "XiguaJerred",
  inventory: "baseline",
  gameMode: "SURVIVAL" as const,
  health: 20,
  food: 20,
  saturation: 5,
  exhaustion: 0,
  allowFlight: false,
  flying: false,
  flySpeed: 0.1,
  invulnerable: false,
  fireTicks: 0,
  level: 3,
  exp: 0.5,
  totalExp: 20,
  slot: 0,
  effects: [],
};
const scene: CaptureScene = {
  name: "test",
  description: "Test",
  bounds: { min: [0, 0, 0], max: [0, 0, 0] },
  staging: [-2, 64, 0],
  inspectors: ["banks"],
  setup: () => Promise.reject(new Error("Never replay setup")),
  run: () => Promise.reject(new Error("Never replay capture")),
};

function fixture(): CaptureRun {
  return RunSchema.parse({
    schema: 1,
    id: "capture-test",
    target: "live",
    name: "XiguaJerred",
    reason: "test recovery",
    inspectors: scene.inspectors,
    server: null,
    baseline: regionFingerprint(terrain),
    scene: "deleted-scene.ts",
    sceneHash: "old",
    box,
    anchor: [0, 64, 0],
    state: "needs-recovery",
    checkpoint,
    snapshot: "snapshot-test",
    inspection: { banks: "" },
    origin: {
      world: "minecraft:overworld",
      position: [-4, 64, 0],
      yaw: 0,
      pitch: 0,
    },
    staging: [-2, 64, 0],
    cleanup: [
      { kind: "command", command: "restore-track" },
      { kind: "resource", resource: "shop-access", id: "false" },
    ],
    captures: [],
    error: "interrupted",
  });
}

class FakeTransport extends CaptureTransport {
  readonly events: string[] = [];
  failResource = false;
  corruptTerrain = false;
  restored = false;
  override world<T extends z.ZodType>(
    schema: T,
    action: string,
    body?: unknown,
  ): Promise<z.infer<T>> {
    this.events.push(action);
    if (action === "capture-cleanup" && this.failResource)
      return Promise.reject(new Error("storage unavailable"));
    const values: Record<string, unknown> = {
      "capture-cleanup": { removed: true },
      "capture-inspect": { inspection: { banks: "" } },
      "snapshot-restore": { changed: 1 },
      "region-read": this.corruptTerrain
        ? { ...terrain, palette: ["minecraft:dirt"] }
        : terrain,
      "capture-player": this.restored
        ? checkpoint
        : { ...checkpoint, inventory: "demo", gameMode: "CREATIVE" },
      "capture-player-restore": { restored: true },
    };
    if (action === "capture-player-restore") {
      expect(body).toEqual({ checkpoint, expectedInventory: "demo" });
      this.restored = true;
    }
    return Promise.resolve(schema.parse(values[action]));
  }
}

function driver(transport: FakeTransport): Parameters<typeof restoreScene>[3] {
  return {
    transport,
    world: {
      name: "world",
      key: "minecraft:overworld",
      environment: "NORMAL",
      minY: -64,
      maxY: 319,
    },
    beginCleanup: () => {
      transport.events.push("begin");
    },
    command: (command) => {
      transport.events.push(command);
      return Promise.resolve();
    },
    teleport: (position) => {
      transport.events.push(`tp:${position.join(",")}`);
      return Promise.resolve();
    },
    lookAt: () => Promise.resolve(),
    status: () =>
      Promise.reject(
        new Error("This fixture does not contain native block cleanup"),
      ),
    native: (action) => {
      transport.events.push(action);
      return Promise.resolve(undefined);
    },
    bounded: () => Promise.resolve({ result: undefined }),
  };
}

describe("capture recovery", () => {
  it("refuses a new site until the same target and account's interrupted run has been restored", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "capture-pending-"));
    try {
      const previous = fixture();
      await initializeRun(path.join(root, "capture-previous"), previous);
      const next = fixture();
      next.id = "capture-next";
      await expect(
        assertNoPendingRun(path.join(root, next.id), next),
      ).rejects.toThrow("Recover capture-test");
      await expect(
        assertNoPendingRun(path.join(root, next.id), {
          ...next,
          target: "sandbox",
        }),
      ).resolves.toBeUndefined();
      previous.state = "failed";
      await Bun.write(
        path.join(root, "capture-previous/run.json"),
        JSON.stringify(previous),
      );
      await expect(
        assertNoPendingRun(path.join(root, next.id), next),
      ).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("replays durable compensation in reverse order and restores terrain before the original inventory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "capture-recovery-"));
    const directory = path.join(root, "run");
    try {
      const run = fixture();
      await initializeRun(directory, run);
      const transport = new FakeTransport("live", "test");
      await restoreScene(directory, scene, run, driver(transport));
      expect(transport.events).toEqual([
        "begin",
        "release",
        "close",
        "capture-cleanup",
        "restore-track",
        "capture-inspect",
        "tp:-2,64,0",
        "snapshot-restore",
        "region-read",
        "tp:-4,64,0",
        "capture-player",
        "capture-player-restore",
        "capture-player",
      ]);
      expect(
        RunSchema.parse(await Bun.file(path.join(directory, "run.json")).json())
          .cleanup,
      ).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("retains a failed compensation for recovery instead of restoring terrain over registered resources", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "capture-recovery-"));
    const directory = path.join(root, "run");
    try {
      const run = fixture();
      await initializeRun(directory, run);
      const transport = new FakeTransport("live", "test");
      transport.failResource = true;
      await expect(
        restoreScene(directory, scene, run, driver(transport)),
      ).rejects.toThrow("storage unavailable");
      expect(
        RunSchema.parse(await Bun.file(path.join(directory, "run.json")).json())
          .cleanup,
      ).toHaveLength(2);
      expect(transport.events).not.toContain("snapshot-restore");
      transport.failResource = false;
      await restoreScene(directory, scene, run, driver(transport));
      expect(run.cleanup).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("detects a wrong terrain restore and keeps the inventory checkpoint available", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "capture-recovery-"));
    const directory = path.join(root, "run");
    try {
      const run = fixture();
      await initializeRun(directory, run);
      const transport = new FakeTransport("live", "test");
      transport.corruptTerrain = true;
      await expect(
        restoreScene(directory, scene, run, driver(transport)),
      ).rejects.toThrow("Restored terrain differs");
      expect(transport.events).not.toContain("capture-player-restore");
      expect(run.checkpoint).toEqual(checkpoint);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
