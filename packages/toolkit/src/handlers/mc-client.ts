// `toolkit mc client …`: a real rendered Minecraft client (the-storm's Fabric
// preview mod) that the daemon runs against a sandbox; usage in MC_USAGE.
import type { ParseArgsOptionsConfig } from "node:util";
import {
  type ClientAction,
  ClientStartRequestSchema,
  ClientActionSchema,
  CLIENT_ACTION_REQUEST_SCHEMAS,
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
import { resolveCredentials } from "#lib/credentials.ts";
import { LIVE_WRITE_OPTIONS, liveWriteFlags } from "#lib/mc/live.ts";

const OPTIONS = {
  ...LIVE_WRITE_OPTIONS,
  account: { type: "string" },
  args: { type: "string" },
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
  account?: string | undefined;
  reason?: string | undefined;
}): Promise<void> {
  const target = await resolveTarget(values.target);
  if (
    target === LIVE_TARGET_ID &&
    (values.account !== "XiguaJerred" ||
      values.reason?.trim() === undefined ||
      values.reason.trim().length === 0)
  )
    throw new Error(
      "Live client start requires --account XiguaJerred and --reason <why>",
    );
  if (target === LIVE_TARGET_ID) await resolveCredentials(["MC_BRIDGE_TOKEN"]);
  const gameMode = values["game-mode"]?.toUpperCase();
  await mcClientStartCommand(
    ClientStartRequestSchema.parse({
      target,
      name:
        values.account ??
        values.name ??
        (target === LIVE_TARGET_ID ? "XiguaJerred" : DEFAULT_CLIENT_NAME),
      op: values.op,
      ...(gameMode === undefined ? {} : { gameMode }),
    }),
    values.json,
    { reason: values.reason },
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
  const parsedAction =
    values.args === undefined ? undefined : ClientActionSchema.parse(action);
  const request =
    parsedAction === undefined
      ? actionRequest(action, positionals, values.ticks)
      : {
          action: parsedAction,
          body: CLIENT_ACTION_REQUEST_SCHEMAS[parsedAction].parse(
            JSON.parse(values.args ?? "{}"),
          ),
        };
  await mcClientActionCommand(
    await resolveClient(values.name),
    request.action,
    request.body,
    { json, write: liveWriteFlags(values) },
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
  const parsed = ClientActionSchema.safeParse(action);
  if (parsed.success)
    return {
      action: parsed.data,
      body: CLIENT_ACTION_REQUEST_SCHEMAS[parsed.data].parse({}),
    };
  throw new Error(
    `Error: unknown client action "${action}"; use start, ls, status, look, move, hotbar, use, attack, release, command, capture or stop`,
  );
}
