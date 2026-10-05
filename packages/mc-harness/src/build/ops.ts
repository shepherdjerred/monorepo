import { withoutNeighborDerived } from "@shepherdjerred/mc-build/core/block-state.ts";
import type { BlockGrid } from "@shepherdjerred/mc-build/core/grid.ts";
import {
  gridFromRegionRead,
  type Vec3,
} from "@shepherdjerred/mc-build/core/grid.ts";
import type { Box, WeOp } from "#protocol/bridge.ts";
import type { Op } from "#protocol/build.ts";
import type { DaemonClient } from "./daemon-client.ts";
import type { BuildWorkspace } from "./workspace.ts";

/** Max WorldEdit ops per bridge request (the bridge contract caps at 64). */
const WE_BATCH = 64;

export type RunContext = {
  client: DaemonClient;
  target: string;
  workspace: BuildWorkspace;
  session: string;
};

function weOp(op: Extract<Op, { kind: "we" }>): WeOp {
  return {
    command: op.command,
    ...(op.pos1 === undefined ? {} : { pos1: op.pos1 }),
    ...(op.pos2 === undefined ? {} : { pos2: op.pos2 }),
    ...(op.at === undefined ? {} : { at: op.at }),
  };
}

async function runWeBatch(
  context: RunContext,
  world: string,
  batch: WeOp[],
): Promise<void> {
  const response = await context.client.we(context.target, {
    session: context.session,
    world,
    ops: batch,
  });
  const failed = response.results.find((result) => !result.ok);
  if (failed !== undefined) {
    throw new Error(
      `WorldEdit op failed: ${failed.command}\n  ${[...failed.errors, ...failed.messages].join("\n  ")}`,
    );
  }
}

async function runSingle(
  context: RunContext,
  op: Exclude<Op, { kind: "we" }>,
): Promise<void> {
  if (op.kind === "command") {
    const result = await context.client.command(context.target, op.command);
    if (!result.success) {
      throw new Error(
        `Command failed: ${op.command}\n  ${result.output.join("\n  ")}`,
      );
    }
    return;
  }
  const bytes = await Bun.file(
    context.workspace.file(op.schematic),
  ).arrayBuffer();
  await context.client.paste(context.target, {
    session: context.session,
    world: op.world,
    schematic: Buffer.from(bytes).toString("base64"),
    at: op.at,
    rotate: op.rotate,
    ignoreAir: op.ignoreAir,
  });
}

/** Runs ops in order, batching consecutive WorldEdit ops in the same world. */
export async function runOps(
  context: RunContext,
  ops: readonly Op[],
): Promise<number> {
  let batch: WeOp[] = [];
  let batchWorld: string | null = null;
  const flush = async () => {
    if (batchWorld !== null && batch.length > 0) {
      await runWeBatch(context, batchWorld, batch);
    }
    batch = [];
    batchWorld = null;
  };
  for (const op of ops) {
    if (op.kind === "we") {
      if (batchWorld !== op.world || batch.length >= WE_BATCH) {
        await flush();
        batchWorld = op.world;
      }
      batch.push(weOp(op));
    } else {
      await flush();
      await runSingle(context, op);
    }
  }
  await flush();
  return ops.length;
}

/** Pastes the captured site back over its box (air included): a clean canvas. */
export async function resetToSite(
  context: RunContext,
  box: Box,
): Promise<void> {
  await context.client.paste(context.target, {
    session: context.session,
    world: box.world,
    schematic: await context.workspace.siteSchematicBase64(),
    at: box.min,
    rotate: 0,
    ignoreAir: false,
  });
}

export async function readGrid(
  client: DaemonClient,
  target: string,
  box: Box,
): Promise<BlockGrid> {
  return gridFromRegionRead(await client.regionRead(target, box));
}

export type GridDiff = {
  mismatches: number;
  samples: { at: Vec3; expected: string; actual: string }[];
};

/**
 * Cell diff with sample positions translated to world coordinates. Ignores
 * neighbor-derived state (pane/fence/wall connections, stair shape, leaf
 * distance) that the server recomputes after a paste.
 */
export function diffGrids(
  expected: BlockGrid,
  actual: BlockGrid,
  origin: Vec3,
): GridDiff {
  const result = expected.diff(actual, 10, withoutNeighborDerived);
  return {
    mismatches: result.count,
    samples: result.mismatches.map((mismatch) => ({
      ...mismatch,
      at: {
        x: mismatch.at.x + origin.x,
        y: mismatch.at.y + origin.y,
        z: mismatch.at.z + origin.z,
      },
    })),
  };
}
