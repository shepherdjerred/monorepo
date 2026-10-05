// `toolkit mc client …`: a real rendered Minecraft client (the-storm's Fabric
// preview mod) that the daemon runs against a sandbox; usage in MC_USAGE.
import type { ParseArgsOptionsConfig } from "node:util";
import {
  type ClientAction,
  ClientStartRequestSchema,
  DEFAULT_CLIENT_NAME,
} from "@shepherdjerred/mc-harness/protocol/client.ts";
import { LIVE_TARGET_ID } from "@shepherdjerred/mc-harness/protocol/live.ts";
import {
  mcClientActionCommand,
  mcClientCaptureCommand,
  mcClientListCommand,
  mcClientStartCommand,
  mcClientStatusCommand,
  mcClientStopCommand,
  resolveClient,
  runningClientNames,
} from "#commands/mc/client.ts";
import {
  captureOut,
  hotbarBody,
  lookBody,
  moveBody,
} from "#lib/mc/game-client.ts";
import { resolveTarget } from "#lib/mc/target.ts";
import { parseMcArgs } from "./mc-args.ts";

const OPTIONS = {
  target: { type: "string" },
  name: { type: "string" },
  json: { type: "boolean", default: false },
  op: { type: "boolean", default: false },
  "game-mode": { type: "string" },
  ticks: { type: "string" },
  out: { type: "string" },
  all: { type: "boolean", default: false },
} as const satisfies ParseArgsOptionsConfig;

async function start(values: {
  target?: string | undefined;
  name?: string | undefined;
  op: boolean;
  "game-mode"?: string | undefined;
  json: boolean;
}): Promise<void> {
  const target = await resolveTarget(values.target);
  if (target === LIVE_TARGET_ID) {
    throw new Error(
      "Error: the real client joins sandboxes only (offline-mode loopback); live tsmc is online-mode. Use an actor or a sandbox.",
    );
  }
  const gameMode = values["game-mode"]?.toUpperCase();
  await mcClientStartCommand(
    ClientStartRequestSchema.parse({
      target,
      name: values.name ?? DEFAULT_CLIENT_NAME,
      op: values.op,
      ...(gameMode === undefined ? {} : { gameMode }),
    }),
    values.json,
  );
}

export async function handleMcClient(args: string[]): Promise<void> {
  const [action = "", ...rest] = args;
  const { values, positionals } = parseMcArgs(OPTIONS, rest, {});
  const { json } = values;
  switch (action) {
    case "start": {
      await start(values);
      return;
    }
    case "ls": {
      await mcClientListCommand(json);
      return;
    }
    case "stop": {
      const names = values.all
        ? await runningClientNames()
        : [await resolveClient(values.name)];
      await mcClientStopCommand(names, json);
      return;
    }
  }
  if (action === "status") {
    await mcClientStatusCommand(await resolveClient(values.name), json);
    return;
  }
  if (action === "capture") {
    const out = captureOut(values.out, process.cwd());
    await mcClientCaptureCommand(await resolveClient(values.name), out, json);
    return;
  }
  // Arguments are validated before the daemon is contacted.
  const request = actionRequest(action, positionals, values.ticks);
  await mcClientActionCommand(
    await resolveClient(values.name),
    request.action,
    request.body,
    json,
  );
}

function actionRequest(
  action: string,
  positionals: string[],
  ticks: string | undefined,
): { action: ClientAction; body: Record<string, unknown> } {
  switch (action) {
    case "look": {
      return { action, body: lookBody(positionals) };
    }
    case "move": {
      return { action, body: moveBody(positionals, ticks) };
    }
    case "hotbar": {
      return { action, body: hotbarBody(positionals) };
    }
    case "command": {
      if (positionals.length === 0) {
        throw new Error("Error: command needs <text…>");
      }
      return { action, body: { text: positionals.join(" ") } };
    }
    case "use":
    case "attack":
    case "release": {
      return { action, body: {} };
    }
  }
  throw new Error(
    `Error: unknown client action "${action}"; use start, ls, status, look, move, hotbar, use, attack, release, command, capture or stop`,
  );
}
