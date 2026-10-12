import type { z } from "zod";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  type BlockPos,
  type Box,
  CommandResponseSchema,
  EventsResponseSchema,
  InfoResponseSchema,
  PlayersResponseSchema,
  RegionReadResponseSchema,
  RegistryResponseSchema,
  SnapshotListResponseSchema,
  SnapshotRestoreResponseSchema,
  SnapshotSchema,
  type WeOp,
  WePasteResponseSchema,
  WeRunResponseSchema,
  WeUndoResponseSchema,
} from "@shepherdjerred/mc-harness/protocol/bridge.ts";
import {
  LogsResponseSchema,
  SnapshotBytesResponseSchema,
} from "@shepherdjerred/mc-harness/protocol/ipc.ts";
import {
  type LiveWriteFlags,
  liveWriteHeaders,
} from "@shepherdjerred/mc-harness/protocol/live.ts";
import { withRecordedBuild } from "#lib/mc/build.ts";
import { daemonRequest, daemonSend } from "#lib/mc/client.ts";
import {
  renderCommand,
  renderEvents,
  renderInfo,
  renderPlayers,
  renderRegion,
  renderSnapshot,
  renderWe,
} from "#lib/mc/render.ts";
import { resolveTarget } from "#lib/mc/target.ts";

export type TargetOptions = {
  target: string | undefined;
  json: boolean;
  /** Live write flags; the daemon requires a reason for `--target live` writes. */
  write?: LiveWriteFlags | undefined;
};

/** POSTs a write to the target; live writes carry the guard's flags as headers. */
async function postWrite<Schema extends z.ZodType>(
  schema: Schema,
  options: TargetOptions,
  action: string,
  body: unknown,
): Promise<z.infer<Schema>> {
  return daemonSend(schema, "POST", await targetPath(options, action), {
    body,
    headers: liveWriteHeaders(options.write ?? {}),
  });
}

/** `--record <buildDir>`: append the op to that build's op log on success. */
export type RecordOption = { record: string | undefined };

function print<T>(json: boolean, value: T, render: (value: T) => string): void {
  console.log(json ? JSON.stringify(value, null, 2) : render(value));
}

async function targetPath(
  options: TargetOptions,
  action: string,
): Promise<string> {
  const id = await resolveTarget(options.target);
  return `/targets/${encodeURIComponent(id)}/${action}`;
}

export async function mcCmdCommand(
  options: TargetOptions & RecordOption,
  command: string,
): Promise<void> {
  await withRecordedBuild(options.record, async (record) => {
    const result = await postWrite(CommandResponseSchema, options, "command", {
      command,
    });
    print(options.json, result, renderCommand);
    if (!result.success) {
      process.exitCode = 1;
      return;
    }
    if (record !== null) {
      await record.append({
        kind: "command",
        command,
        source: "manual",
      });
    }
  });
}

export async function mcWeCommand(
  options: TargetOptions & RecordOption & { session: string; world: string },
  op: WeOp,
): Promise<void> {
  await withRecordedBuild(options.record, async (record) => {
    const result = await postWrite(WeRunResponseSchema, options, "we", {
      session: options.session,
      world: options.world,
      ops: [op],
    });
    print(options.json, result, renderWe);
    if (result.results.some((entry) => !entry.ok)) {
      process.exitCode = 1;
      return;
    }
    if (record !== null) {
      await record.append({
        kind: "we",
        world: options.world,
        ...op,
        source: "manual",
      });
    }
  });
}

export async function mcWeUndoCommand(
  options: TargetOptions & { session: string },
  steps: number,
): Promise<void> {
  const result = await postWrite(WeUndoResponseSchema, options, "undo", {
    session: options.session,
    steps,
  });
  print(
    options.json,
    result,
    (value) =>
      `undid ${String(value.undone)} edit(s); history ${String(value.historySize)}`,
  );
}

export async function mcPasteCommand(
  options: TargetOptions & RecordOption & { session: string; world: string },
  paste: {
    file: string;
    at: BlockPos;
    rotate: 0 | 90 | 180 | 270;
    ignoreAir: boolean;
  },
): Promise<void> {
  const bytes = await Bun.file(paste.file).arrayBuffer();
  await withRecordedBuild(options.record, async (record) => {
    const result = await postWrite(WePasteResponseSchema, options, "paste", {
      session: options.session,
      world: options.world,
      schematic: Buffer.from(bytes).toString("base64"),
      at: paste.at,
      rotate: paste.rotate,
      ignoreAir: paste.ignoreAir,
    });
    print(
      options.json,
      result,
      (value) =>
        `pasted ${String(value.changed)} block(s) into ${String(value.min.x)},${String(value.min.y)},${String(value.min.z)} → ${String(value.max.x)},${String(value.max.y)},${String(value.max.z)}; history ${String(value.historySize)}`,
    );
    if (record !== null) {
      await record.append({
        kind: "paste",
        world: options.world,
        schematic: await record.schematic(new Uint8Array(bytes)),
        at: paste.at,
        rotate: paste.rotate,
        ignoreAir: paste.ignoreAir,
        source: "manual",
      });
    }
  });
}

export async function mcRegionReadCommand(
  options: TargetOptions,
  box: Box,
  out: string | undefined,
): Promise<void> {
  const region = await postWrite(
    RegionReadResponseSchema,
    options,
    "region-read",
    box,
  );
  if (out !== undefined) {
    await mkdir(path.dirname(path.resolve(out)), { recursive: true });
    await Bun.write(out, JSON.stringify(region));
    console.error(`wrote ${out}`);
  }
  print(options.json && out === undefined, region, renderRegion);
}

export async function mcSnapshotCreateCommand(
  options: TargetOptions,
  box: Box,
  label: string | undefined,
): Promise<void> {
  const snapshot = await daemonRequest(
    SnapshotSchema,
    "POST",
    await targetPath(options, "snapshot"),
    { box, ...(label === undefined ? {} : { label }) },
  );
  print(options.json, snapshot, renderSnapshot);
}

export async function mcSnapshotListCommand(
  options: TargetOptions,
): Promise<void> {
  const { snapshots } = await daemonRequest(
    SnapshotListResponseSchema,
    "GET",
    await targetPath(options, "snapshots"),
  );
  print(options.json, snapshots, (value) =>
    value.length === 0
      ? "No snapshots."
      : value.map((snapshot) => renderSnapshot(snapshot)).join("\n"),
  );
}

export async function mcSnapshotGetCommand(
  options: TargetOptions,
  id: string,
  out: string,
): Promise<void> {
  const { base64 } = await daemonRequest(
    SnapshotBytesResponseSchema,
    "GET",
    await targetPath(options, `snapshots/${encodeURIComponent(id)}`),
  );
  const bytes = Buffer.from(base64, "base64");
  await Bun.write(out, bytes);
  console.log(`wrote ${out} (${String(bytes.length)} B)`);
}

export async function mcSnapshotRestoreCommand(
  options: TargetOptions,
  id: string,
): Promise<void> {
  const result = await daemonRequest(
    SnapshotRestoreResponseSchema,
    "POST",
    await targetPath(options, "snapshot-restore"),
    { id },
  );
  print(
    options.json,
    result,
    (value) => `restored ${id}: ${String(value.changed)} block(s) changed`,
  );
}

export async function mcInfoCommand(options: TargetOptions): Promise<void> {
  const info = await daemonRequest(
    InfoResponseSchema,
    "GET",
    await targetPath(options, "info"),
  );
  print(options.json, info, renderInfo);
}

export async function mcRegistryCommand(
  options: TargetOptions,
  out: string,
): Promise<void> {
  const registry = await daemonRequest(
    RegistryResponseSchema,
    "GET",
    await targetPath(options, "registry"),
  );
  await mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await Bun.write(out, JSON.stringify(registry));
  console.log(
    `wrote ${out}: ${registry.blocks.length.toString()} blocks (Minecraft ${registry.minecraftVersion}, data ${registry.dataVersion.toString()})`,
  );
}

export async function mcPlayersCommand(options: TargetOptions): Promise<void> {
  const { players } = await daemonRequest(
    PlayersResponseSchema,
    "GET",
    await targetPath(options, "players"),
  );
  print(options.json, players, renderPlayers);
}

export async function mcEventsCommand(
  options: TargetOptions,
  since: number,
  limit: number,
): Promise<void> {
  const query = new URLSearchParams({
    since: since.toString(),
    limit: limit.toString(),
  });
  const result = await daemonRequest(
    EventsResponseSchema,
    "GET",
    await targetPath(options, `events?${query.toString()}`),
  );
  print(options.json, result, (value) =>
    [
      ...(value.truncated ? ["(older events were dropped)"] : []),
      renderEvents(value.events),
      `cursor: ${String(value.cursor)}`,
    ]
      .filter((line) => line.length > 0)
      .join("\n"),
  );
}

export async function mcLogsCommand(
  options: TargetOptions,
  lines: number,
): Promise<void> {
  const result = await daemonRequest(
    LogsResponseSchema,
    "GET",
    await targetPath(options, `logs?lines=${lines.toString()}`),
  );
  print(options.json, result, (value) => value.lines.join("\n"));
}
