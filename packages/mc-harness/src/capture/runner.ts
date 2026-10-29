import {
  CaptureInspectionSchema,
  PlayerCheckpointSchema,
} from "#protocol/capture.ts";
import { SnapshotSchema, RegionReadResponseSchema } from "#protocol/bridge.ts";
import { regionFingerprint } from "./admission.ts";
import { save, type CaptureRun } from "./model.ts";
import type { CaptureScene } from "./define.ts";
import { createDriver } from "./driver.ts";
import { restoreScene } from "./recovery.ts";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { withPublicationLock } from "#protocol/publication-lock.ts";
import { assertNoPendingRun } from "./pending.ts";

export async function runScene(
  directory: string,
  scene: CaptureScene,
  run: CaptureRun,
  recovery = false,
): Promise<CaptureRun> {
  const lock = path.join(
    path.dirname(directory),
    "locks",
    `${encodeURIComponent(run.target)}-${run.name}`,
  );
  await mkdir(lock, { recursive: true, mode: 0o700 });
  return withPublicationLock(lock, () =>
    executeScene(directory, scene, run, recovery),
  );
}

async function executeScene(
  directory: string,
  scene: CaptureScene,
  run: CaptureRun,
  recovery: boolean,
): Promise<CaptureRun> {
  let driver: Awaited<ReturnType<typeof createDriver>>;
  try {
    if (!recovery) await assertNoPendingRun(directory, run);
    driver = await createDriver(directory, run);
  } catch (error) {
    run.error = error instanceof Error ? error.message : String(error);
    run.state = run.checkpoint === null ? "failed" : "needs-recovery";
    await save(directory, run);
    return run;
  }
  const stage = { cleaning: false };
  const restore = async () => {
    stage.cleaning = true;
    await restoreScene(directory, scene, run, driver);
  };
  try {
    if (!recovery) await captureScene(directory, scene, run, driver);
    await restore();
    run.state = run.error === "" ? "complete" : "failed";
  } catch (error) {
    run.error = error instanceof Error ? error.message : String(error);
    await recoverFailure(run, stage.cleaning, restore);
  }
  await save(directory, run);
  return run;
}

async function recoverFailure(
  run: CaptureRun,
  cleaning: boolean,
  restore: () => Promise<void>,
): Promise<void> {
  if (cleaning) {
    run.state = "needs-recovery";
    return;
  }
  run.state = "failed";
  if (run.checkpoint === null) return;
  try {
    await restore();
  } catch (error) {
    run.error += `; cleanup: ${String(error)}`;
    run.state = "needs-recovery";
  }
}

async function captureScene(
  directory: string,
  scene: CaptureScene,
  run: CaptureRun,
  driver: Awaited<ReturnType<typeof createDriver>>,
): Promise<void> {
  const { transport, context, status } = driver;

  run.server = driver.worldInfo;
  const region = await transport.world(
    RegionReadResponseSchema,
    "region-read",
    run.box,
  );
  if (region.blockEntities.length > 0)
    throw new Error(
      "Site contains existing block entities; choose another wilderness site",
    );
  run.baseline = regionFingerprint(region);
  const { inspection } = await transport.world(
    CaptureInspectionSchema,
    "capture-inspect",
    run.box,
  );
  if (run.target === "live" && inspection["wilderness"] !== "true")
    throw new Error("Fixture area is not entirely wilderness");
  for (const key of scene.inspectors)
    if (
      !(key in inspection) ||
      (key !== "wilderness" && inspection[key] !== "")
    )
      throw new Error(`Site has existing or unavailable ${key} state`);
  run.inspection = inspection;
  const player = await status();
  if (!player.connected) throw new Error("Client disconnected");
  if (player.screen !== "")
    throw new Error("Close player menus before checkpointing a scene");
  run.origin = {
    world: player.world,
    position: player.position,
    yaw: player.yaw,
    pitch: player.pitch,
  };
  run.checkpoint = await transport.world(
    PlayerCheckpointSchema,
    "capture-player",
    { name: run.name },
  );
  run.state = "checkpoint";
  await save(directory, run);
  await context.teleport(context.at(...scene.staging), 0, 0);
  const snapshot = await transport.world(SnapshotSchema, "snapshot", {
    box: run.box,
    label: run.id,
  });
  run.snapshot = snapshot.id;
  run.state = "setup";
  await save(directory, run);
  // The original inventory is durable before any temporary demo items are introduced.
  await context.command(`minecraft:clear ${run.name}`);
  await scene.setup(context);
  run.state = "capture";
  await save(directory, run);
  await scene.run(context);
}
