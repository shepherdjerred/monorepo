import { z } from "zod";
import {
  RegionReadResponseSchema,
  SnapshotRestoreResponseSchema,
} from "#protocol/bridge.ts";
import {
  CaptureInspectionSchema,
  PlayerCheckpointSchema,
} from "#protocol/capture.ts";
import type { CaptureScene } from "./define.ts";
import { save, type CaptureRun } from "./model.ts";
import type { createDriver } from "./driver.ts";
import { regionFingerprint } from "./admission.ts";
import { fixtureAim } from "./camera.ts";

type Driver = Pick<
  Awaited<ReturnType<typeof createDriver>>,
  | "transport"
  | "command"
  | "playerCommand"
  | "teleport"
  | "lookAt"
  | "bounded"
  | "attack"
  | "world"
  | "native"
  | "beginCleanup"
  | "status"
>;
type Cleanup = CaptureRun["cleanup"][number];

async function waitForFixtureTarget(
  driver: Driver,
  position: [number, number, number],
): Promise<void> {
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    const state = await driver.status();
    if (!state.connected)
      throw new Error("Client disconnected during fixture cleanup");
    const point = state.target["position"];
    if (
      state.target.kind === "block" &&
      Array.isArray(point) &&
      point.length === 3 &&
      point.every((value, index) => value === position[index])
    )
      return;
    await Bun.sleep(50);
  }
  throw new Error("Fixture sign is not under the settled crosshair");
}

async function removeFixture(
  driver: Driver,
  cleanup: Cleanup,
  run: CaptureRun,
): Promise<void> {
  if (cleanup.kind === "player-command") {
    await driver.teleport(cleanup.standing, 0, 0);
    await driver.lookAt(cleanup.look);
    await driver.playerCommand(cleanup.command, cleanup.expectedMessage);
    return;
  }
  if (cleanup.kind === "command") {
    await driver.command(cleanup.command);
    return;
  }
  if (cleanup.kind === "resource") {
    await driver.transport.world(
      z.strictObject({ removed: z.literal(true) }),
      "capture-cleanup",
      { name: run.name, resource: cleanup.resource, id: cleanup.id },
    );
    return;
  }
  const [x, y, zz] = cleanup.position;
  const box = {
    world: run.box.world,
    min: { x, y, z: zz },
    max: { x, y, z: zz },
  };
  const before = await driver.transport.world(
    RegionReadResponseSchema,
    "region-read",
    box,
  );
  if (before.palette.every((block) => block === "minecraft:air")) return;
  const state = await driver.status();
  if (!state.connected)
    throw new Error("Client disconnected during fixture cleanup");
  const empty = state.inventory.find(
    (item) =>
      item.slot >= 0 &&
      item.slot < 8 &&
      item.count === 0 &&
      item.type === "minecraft:air",
  );
  if (empty === undefined)
    throw new Error("Fixture sign cleanup requires an empty hotbar slot");
  // Special tools and the reserved travel compass intercept ordinary punches.
  await driver.native("hotbar", { slot: empty.slot });
  await driver.teleport(cleanup.standing, 0, 0);
  const targetBlock =
    before.palette[Buffer.from(before.blocks, "base64").readUInt32LE(0)];
  if (targetBlock === undefined)
    throw new Error("Cleanup target has no block state");
  await driver.lookAt(fixtureAim(cleanup.position, targetBlock));
  await waitForFixtureTarget(driver, cleanup.position);
  // One swing cannot continue through the removed sign into its surroundings.
  await driver.attack(cleanup.sneak);
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    const after = await driver.transport.world(
      RegionReadResponseSchema,
      "region-read",
      box,
    );
    if (after.palette.every((block) => block === "minecraft:air")) return;
    await Bun.sleep(100);
  }
  throw new Error("Fixture sign did not break");
}

async function verifyModules(
  driver: Driver,
  run: CaptureRun,
  inspectors: readonly string[],
): Promise<void> {
  if (run.inspection === null) return;
  const { inspection } = await driver.transport.world(
    CaptureInspectionSchema,
    "capture-inspect",
    run.box,
  );
  for (const key of inspectors)
    if (inspection[key] !== run.inspection[key])
      throw new Error(`Cleanup left ${key} state changed`);
}

async function restoreTerrain(driver: Driver, run: CaptureRun): Promise<void> {
  if (run.snapshot !== null) {
    if (run.staging === null)
      throw new Error("No verified staging point outside the fixture");
    await driver.teleport(run.staging, 0, 0);
    await driver.transport.world(
      SnapshotRestoreResponseSchema,
      "snapshot-restore",
      { id: run.snapshot },
    );
    const region = await driver.transport.world(
      RegionReadResponseSchema,
      "region-read",
      run.box,
    );
    if (run.baseline === null || regionFingerprint(region) !== run.baseline)
      throw new Error("Restored terrain differs from the checkpoint");
  }
  if (run.origin !== null) {
    if (run.origin.world !== driver.world.key)
      throw new Error("Original world differs from the fixture world");
    await driver.teleport(
      run.origin.position,
      run.origin.yaw,
      run.origin.pitch,
    );
  }
}

async function restorePlayer(driver: Driver, run: CaptureRun): Promise<void> {
  const checkpoint = run.checkpoint;
  if (checkpoint === null) return;
  const current = await driver.transport.world(
    PlayerCheckpointSchema,
    "capture-player",
    { name: run.name },
  );
  await driver.transport.world(
    z.strictObject({ restored: z.literal(true) }),
    "capture-player-restore",
    { checkpoint, expectedInventory: current.inventory },
  );
  const deadline = performance.now() + 30_000;
  while (performance.now() < deadline) {
    const verified = await driver.transport.world(
      PlayerCheckpointSchema,
      "capture-player",
      { name: run.name },
    );
    const modulesMatch = Object.entries(checkpoint.moduleState).every(
      ([key, value]) => verified.moduleState[key] === value,
    );
    if (
      verified.inventory !== checkpoint.inventory ||
      verified.gameMode !== checkpoint.gameMode
    )
      throw new Error("Player restoration differs from checkpoint");
    if (modulesMatch) return;
    await Bun.sleep(100);
  }
  throw new Error("Temporary progression or plugin state was not restored");
}

export async function restoreScene(
  directory: string,
  scene: CaptureScene,
  run: CaptureRun,
  driver: Driver,
): Promise<void> {
  driver.beginCleanup();
  run.state = "cleanup";
  await save(directory, run);
  await driver.native("release");
  await driver.native("close");
  if (run.cleanup.some((cleanup) => cleanup.kind === "break"))
    await driver.command(`minecraft:gamemode creative ${run.name}`);
  while (run.cleanup.length > 0) {
    const cleanup = run.cleanup.at(-1);
    if (cleanup === undefined) throw new Error("Missing cleanup entry");
    await removeFixture(driver, cleanup, run);
    run.cleanup.pop();
    await save(directory, run);
  }
  await verifyModules(driver, run, scene.inspectors);
  await restoreTerrain(driver, run);
  await restorePlayer(driver, run);
}
