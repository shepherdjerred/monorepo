import type { ParseArgsOptionsConfig } from "node:util";
import {
  mcActorActCommand,
  mcActorListCommand,
  mcActorObserveCommand,
  mcActorQuitCommand,
  mcActorSpawnCommand,
  type ActorOptions,
} from "#commands/mc/actor.ts";
import {
  mcPlaytestListCommand,
  mcPlaytestNewCommand,
  mcPlaytestRunCommand,
  mcPlaytestShowCommand,
} from "#commands/mc/playtest.ts";
import { actorActionBody } from "#lib/mc/play.ts";
import {
  LIVE_WRITE_OPTIONS,
  liveWriteFlags,
  type LiveWriteValues,
} from "#lib/mc/live.ts";
import { parseMcArgs } from "./mc-args.ts";
import {
  ACTOR_ACTIONS,
  ActorSpawnRequestSchema,
} from "@shepherdjerred/mc-harness/protocol/bridge.ts";
import {
  parseBlockPos,
  ProfileSchema,
  SandboxIdSchema,
  WorldKindSchema,
} from "@shepherdjerred/mc-harness/protocol/ipc.ts";

// `toolkit mc actor …` and `toolkit mc playtest …`; usage lives in MC_USAGE (handlers/mc-usage.ts).

const COMMON = {
  target: { type: "string" },
  json: { type: "boolean", default: false },
  ...LIVE_WRITE_OPTIONS,
} as const satisfies ParseArgsOptionsConfig;

function fail(message: string): never {
  console.error(`Error: ${message}`);
  console.error("Run `toolkit mc help` for usage.");
  process.exit(1);
}

function parse<const Options extends ParseArgsOptionsConfig>(
  args: string[],
  options: Options,
) {
  return parseMcArgs(COMMON, args, options);
}

function targetOptions(
  values: LiveWriteValues & {
    target?: string | undefined;
    json?: boolean | undefined;
  },
): ActorOptions {
  return {
    target: values.target,
    json: values.json === true,
    write: liveWriteFlags(values),
  };
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${name} is required`);
  }
  return value;
}

export async function handleMcActor(args: string[]): Promise<void> {
  const [action = "", ...rest] = args;
  const { values, positionals } = parse(rest, {
    world: { type: "string", default: "world" },
    at: { type: "string" },
    "game-mode": { type: "string" },
    op: { type: "boolean", default: false },
    all: { type: "boolean", default: false },
    pos: { type: "string" },
    range: { type: "string" },
    timeout: { type: "string" },
    item: { type: "string" },
    count: { type: "string" },
    slot: { type: "string" },
    block: { type: "string" },
    entity: { type: "string" },
    type: { type: "string" },
  });
  const options = targetOptions(values);
  const [name, ...text] = positionals;
  switch (action) {
    case "spawn": {
      const gameMode = values["game-mode"];
      await mcActorSpawnCommand(
        options,
        ActorSpawnRequestSchema.parse({
          name: requireString(name, "<name>"),
          world: values.world,
          at: parseBlockPos(requireString(values.at, "--at")),
          ...(gameMode === undefined ? {} : { gameMode }),
          op: values.op,
        }),
      );
      return;
    }
    case "ls": {
      await mcActorListCommand(options);
      return;
    }
    case "observe": {
      await mcActorObserveCommand(options, requireString(name, "<name>"));
      return;
    }
    case "quit": {
      if (!values.all && positionals.length === 0) {
        fail("actor quit needs <name…> or --all");
      }
      await mcActorQuitCommand(options, positionals, values.all);
      return;
    }
    case "act": {
      const [verb, ...words] = text;
      const act = ACTOR_ACTIONS.find((candidate) => candidate === verb);
      if (act === undefined) {
        fail(`actor act needs one of ${ACTOR_ACTIONS.join(", ")}`);
      }
      await mcActorActCommand(
        options,
        requireString(name, "<name>"),
        act,
        actorActionBody(act, values, words.join(" ")),
      );
      return;
    }
  }
  fail(`unknown actor action "${action}"`);
}

export async function handleMcPlaytest(args: string[]): Promise<void> {
  const [action = "", ...rest] = args;
  const { values, positionals } = parse(rest, {
    profile: { type: "string" },
    world: { type: "string" },
    grep: { type: "string" },
    keep: { type: "boolean", default: false },
    dir: { type: "string", default: "playtests" },
  });
  switch (action) {
    case "run": {
      if (positionals.length === 0) {
        fail("playtest run needs <file|dir…>");
      }
      if (values.target === "live") {
        fail(
          "playtests run on sandboxes only; use actors and commands for live checks",
        );
      }
      await mcPlaytestRunCommand(
        positionals,
        {
          keep: values.keep,
          ...(values.target === undefined
            ? {}
            : { target: SandboxIdSchema.parse(values.target) }),
          ...(values.profile === undefined
            ? {}
            : { profile: ProfileSchema.parse(values.profile) }),
          ...(values.world === undefined
            ? {}
            : { world: WorldKindSchema.parse(values.world) }),
          ...(values.grep === undefined ? {} : { grep: values.grep }),
        },
        values.json,
      );
      return;
    }
    case "ls": {
      await mcPlaytestListCommand(values.json);
      return;
    }
    case "show": {
      await mcPlaytestShowCommand(
        requireString(positionals[0], "<run-id>"),
        values.json,
      );
      return;
    }
    case "new": {
      await mcPlaytestNewCommand(
        requireString(positionals[0], "<name>"),
        values.dir,
      );
      return;
    }
  }
  fail(`unknown playtest action "${action}"`);
}
