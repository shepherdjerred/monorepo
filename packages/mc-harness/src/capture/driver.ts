import { appendFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  CommandResponseSchema,
  InfoResponseSchema,
  PlayersResponseSchema,
  RegionReadResponseSchema,
  WeRunResponseSchema,
} from "#protocol/bridge.ts";
import {
  ClientActionResponseSchema,
  ClientCaptureResponseSchema,
  ClientStatusResponseSchema,
} from "#protocol/client.ts";

import { createCaptureSaver } from "./artifacts.ts";
import {
  PlayerCheckpointSchema,
  CaptureInspectionSchema,
} from "#protocol/capture.ts";
import { CaptureTransport } from "./transport.ts";
import { createMessageControls } from "./messages.ts";
import { createRecorder } from "./recording.ts";
import type { CaptureContext } from "./define.ts";

import { save, type CaptureRun } from "./model.ts";
import { createLookAt } from "./camera.ts";
import { createInteractions } from "./interactions.ts";

function decimal(value: number): string {
  return Number.isInteger(value) ? value.toFixed(1) : value.toString();
}
export async function createDriver(directory: string, run: CaptureRun) {
  const transport = new CaptureTransport(
    run.target,
    run.reason,
    undefined,
    run.name,
  );
  const clientRoute = `/clients/${encodeURIComponent(run.name)}`;
  const log = async (entry: Record<string, unknown>) => {
    await appendFile(
      path.join(directory, "events.jsonl"),
      `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
    );
  };
  const status = async () => {
    const response = await transport.request(
      ClientStatusResponseSchema,
      "GET",
      clientRoute,
    );
    return response.state;
  };
  const native = async (action: string, args: Record<string, unknown> = {}) => {
    const response = await transport.request(
      ClientActionResponseSchema,
      "POST",
      `${clientRoute}/${action}`,
      args,
    );
    return response.result;
  };
  const bounded = async (action: string, args: Record<string, unknown> = {}) =>
    transport.request(
      z.strictObject({ result: z.unknown() }),
      "POST",
      `${clientRoute}/bounded`,
      { box: run.box, action, arguments: args },
    );
  let cleaning = false;
  const waitFor: CaptureContext["waitFor"] = async (
    description,
    predicate,
    timeoutMs = 30_000,
  ) => {
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      if (!cleaning && (await Bun.file(path.join(directory, "stop")).exists()))
        throw new Error("Capture stopped");
      const state = await status();
      if (predicate(state)) return state;
      await Bun.sleep(100);
    }
    throw new Error(`Timed out waiting for ${description}`);
  };
  const command = async (text: string) => {
    await log({ kind: "command-intent", text });
    const result = await transport.world(CommandResponseSchema, "command", {
      command: text,
    });
    if (!result.success)
      throw new Error(`Command rejected: ${text}: ${result.output.join("\n")}`);
  };
  const worldInfo = await transport.world(InfoResponseSchema, "info");
  if (!worldInfo.capabilities.includes("capture"))
    throw new Error(
      "Server image does not provide the capture bridge capability; deploy the matching server artifact before running scenes",
    );
  const world = worldInfo.worlds.find(
    (candidate) => candidate.name === run.box.world,
  );
  if (world === undefined) throw new Error(`Unknown world ${run.box.world}`);
  const teleport: CaptureContext["teleport"] = async (position, yaw, pitch) => {
    const [x, y, zz] = position;
    const ground = {
      x: Math.floor(x),
      y: Math.floor(y) - 1,
      z: Math.floor(zz),
    };
    const area = await transport.world(
      RegionReadResponseSchema,
      "region-read",
      {
        world: run.box.world,
        min: ground,
        max: { ...ground, y: ground.y + 2 },
      },
    );
    const bytes = Buffer.from(area.blocks, "base64");
    const states = [0, 1, 2].map(
      (index) => area.palette[bytes.readUInt32LE(index * 4)],
    );
    const groundState = states[0];
    const harmless =
      /^minecraft:(?:stone|dirt|grass_block|sand|gravel|deepslate|cobblestone|(?:oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry)_planks|stone_bricks)(?:\[|$)/u;
    if (
      groundState === undefined ||
      !harmless.test(groundState) ||
      states.slice(1).some((block) => block !== "minecraft:air")
    )
      throw new Error(
        "Destination does not have verified safe ground and clearance",
      );
    await command(
      `execute in ${world.key} run minecraft:tp ${run.name} ${[x, y, zz].map((value) => decimal(value)).join(" ")} ${yaw.toString()} ${pitch.toString()}`,
    );
    await waitFor(
      "verified client arrival",
      (state) =>
        state.connected &&
        state.world === world.key &&
        state.position.every(
          (value, index) =>
            Math.abs(value - (position[index] ?? Infinity)) < 0.2,
        ),
    );
    const { players } = await transport.world(PlayersResponseSchema, "players");
    const player = players.find((candidate) => candidate.name === run.name);
    if (
      player?.world !== world.name ||
      Math.hypot(player.pos.x - x, player.pos.y - y, player.pos.z - zz) > 0.5
    )
      throw new Error("Server arrival differs from client arrival");
    if (
      x < run.box.min.x ||
      x > run.box.max.x + 1 ||
      y < run.box.min.y ||
      y > run.box.max.y + 1 ||
      zz < run.box.min.z ||
      zz > run.box.max.z + 1
    ) {
      run.staging = position;
      await save(directory, run);
    }
  };
  const lookAt = createLookAt(status, native, waitFor);
  const messages = createMessageControls(native);
  const interact = createInteractions({
    mark: messages.mark,
    bounded,
    native,
    waitFor,
    status,
    lookAt,
  });
  const saveCapture = createCaptureSaver(directory, run);
  const recording = { active: false };
  const context: CaptureContext = {
    shopAccess: async (enabled) => {
      const before = run.checkpoint?.moduleState["shop.access"];
      if (before !== "true" && before !== "false")
        throw new Error("Shop access checkpoint is unavailable");
      await context.defer({
        kind: "resource",
        resource: "shop-access",
        id: before,
      });
      if (before !== enabled.toString())
        await context.playerCommand(
          "shop access",
          enabled
            ? "You can trade at shops"
            : "You manage your own shops again.",
        );
    },
    feedback: messages.feedback,
    block: async ([x, y, zz]) => {
      const region = await transport.world(
        RegionReadResponseSchema,
        "region-read",
        { world: run.box.world, min: { x, y, z: zz }, max: { x, y, z: zz } },
      );
      const value =
        region.palette[Buffer.from(region.blocks, "base64").readUInt32LE(0)];
      if (value === undefined) throw new Error("Missing block state");
      return value;
    },
    inspect: async () => {
      const result = await transport.world(
        CaptureInspectionSchema,
        "capture-inspect",
        run.box,
      );
      return result.inspection;
    },
    playerCommand: messages.command,
    id: run.id,
    target: run.target,
    track: async (track, level) => {
      if (!Number.isInteger(level) || level < 0 || level > 5)
        throw new Error("Invalid track level");
      const before = run.checkpoint?.moduleState[`track.${track}`];
      if (before === undefined || !/^[0-5]$/u.test(before))
        throw new Error("Track checkpoint unavailable");
      await context.prepare(
        `perks admin set ${run.name} ${track} ${level.toString()}`,
        {
          kind: "command",
          command: `perks admin set ${run.name} ${track} ${before}`,
        },
      );
      const deadline = performance.now() + 30_000;
      while (performance.now() < deadline) {
        const current = await transport.world(
          PlayerCheckpointSchema,
          "capture-player",
          { name: run.name },
        );
        if (current.moduleState[`track.${track}`] === level.toString()) return;
        await Bun.sleep(100);
      }
      throw new Error(`Track ${track} did not reach the requested level`);
    },
    name: run.name,
    box: run.box,
    at: (x, y, zz) => [
      run.anchor[0] + x,
      run.anchor[1] + y,
      run.anchor[2] + zz,
    ],
    status,
    waitFor,
    command,
    teleport,
    lookAt,
    use: (sneak) => interact("use", sneak),
    attack: (sneak) => interact("attack", sneak),
    action: async (action, args = {}) =>
      [
        "use",
        "attack",
        "click",
        "sign-write",
        "screen-activate",
        "screen-type",
        "move",
      ].includes(action)
        ? bounded(action === "move" ? "input" : action, args)
        : native(action, args),
    step: async (name, action) => {
      await log({ kind: "step-start", name });
      if (recording.active)
        await native("record-marker", { name: `${name}-start` });
      await action();
      if (recording.active)
        await native("record-marker", { name: `${name}-end` });
      await log({ kind: "step-complete", name });
    },
    defer: async (cleanup) => {
      run.cleanup.push(cleanup);
      await save(directory, run);
    },
    prepare: async (text, cleanup) => {
      await context.defer(cleanup);
      await command(text);
    },
    set: async (minimum, maximum, block) => {
      if (!/^minecraft:[a-z0-9_]+(?:\[[a-z0-9_=,]+\])?$/u.test(block))
        throw new Error("Invalid block state");
      const [ax, ay, az] = minimum,
        [bx, by, bz] = maximum;
      if (
        ax < run.box.min.x ||
        ay < run.box.min.y ||
        az < run.box.min.z ||
        bx > run.box.max.x ||
        by > run.box.max.y ||
        bz > run.box.max.z ||
        ax > bx ||
        ay > by ||
        az > bz
      )
        throw new Error("Fixture leaves declared bounds");
      if (run.staging === null)
        throw new Error(
          "Fixture edits require a verified outside staging point",
        );
      await teleport(run.staging, 0, 0);
      const result = await transport.world(WeRunResponseSchema, "we", {
        world: run.box.world,
        session: run.id.slice(0, 32),
        ops: [
          {
            command: `//set ${block}`,
            pos1: { x: ax, y: ay, z: az },
            pos2: { x: bx, y: by, z: bz },
          },
        ],
      });
      if (result.results.some((operation) => !operation.ok))
        throw new Error("WorldEdit fixture setup failed");
    },
    sign: async (lines) => {
      await messages.mark();
      await waitFor(
        "sign editor",
        (state) => state.screen === "Edit Sign Message",
      );
      await bounded("sign-write", { lines });
    },
    transfer: async (item, from) => {
      const state = await status();
      if (!state.connected) throw new Error("Client disconnected");
      const view = z
        .object({
          containerId: z.number(),
          stateId: z.number(),
          slots: z.array(
            z.object({ slot: z.number(), type: z.string(), count: z.number() }),
          ),
        })
        .parse(state);
      const split = view.slots.length - 36;
      const slot = view.slots.find(
        (candidate) =>
          candidate.type === item &&
          candidate.count > 0 &&
          (from === "container"
            ? candidate.slot < split
            : candidate.slot >= split),
      );
      if (slot === undefined) throw new Error(`No ${item} in ${from}`);
      await bounded("click", {
        containerId: view.containerId,
        stateId: view.stateId,
        slot: slot.slot,
        button: 0,
        mode: "quick_move",
      });
    },
    capture: async (presentation) => {
      const before = z
        .object({ renderedFrames: z.number() })
        .parse(await status());
      await waitFor(
        "rendered scene",
        (state) =>
          state.connected &&
          state.fps > 0 &&
          state["swinging"] === false &&
          typeof state["renderedFrames"] === "number" &&
          state["renderedFrames"] >= before.renderedFrames + 3,
      );
      const source = path.join(directory, `${presentation.name}.png`);
      const capture = await transport.request(
        ClientCaptureResponseSchema,
        "POST",
        `${clientRoute}/capture`,
        { out: source },
      );
      await saveCapture(presentation, capture.path);
    },
    record: createRecorder(
      native,
      saveCapture,
      path.join(directory, "stop"),
      (value) => {
        recording.active = value;
      },
    ),
  };
  return {
    transport,
    status,
    world,
    worldInfo,
    context,
    native,
    bounded,
    attack: context.attack,
    playerCommand: messages.command,
    command,
    teleport,
    lookAt,
    beginCleanup: () => {
      cleaning = true;
    },
  };
}
