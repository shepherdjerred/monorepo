import type { ParseArgsOptionsConfig } from "node:util";
import { mcBuildCommand } from "#commands/mc/build.ts";
import {
  mcDaemonStartCommand,
  mcDaemonStatusCommand,
  mcDaemonStopCommand,
} from "#commands/mc/daemon.ts";
import {
  mcSandboxDownCommand,
  mcSandboxListCommand,
  mcSandboxUpCommand,
} from "#commands/mc/sandbox.ts";
import {
  mcCmdCommand,
  mcEventsCommand,
  mcInfoCommand,
  mcLogsCommand,
  mcPasteCommand,
  mcPlayersCommand,
  mcRegionReadCommand,
  mcRegistryCommand,
  mcSnapshotCreateCommand,
  mcSnapshotGetCommand,
  mcSnapshotListCommand,
  mcSnapshotRestoreCommand,
  mcWeCommand,
  mcWeUndoCommand,
  type TargetOptions,
} from "#commands/mc/world.ts";
import {
  LIVE_WRITE_OPTIONS,
  liveWriteFlags,
  type LiveWriteValues,
} from "#lib/mc/live.ts";
import { parseMcArgs } from "./mc-args.ts";
import { handleMcClient } from "./mc-client.ts";
import { handleMcFiles } from "./mc-files.ts";
import { handleMcLive } from "./mc-live.ts";
import { MC_USAGE, subcommandUsage } from "./mc-usage.ts";
import { handleMcActor, handleMcPlaytest } from "./mc-play.ts";
import {
  BoxSchema,
  SessionNameSchema,
  WeOpSchema,
  type Box,
} from "@shepherdjerred/mc-harness/protocol/bridge.ts";
import {
  parseBlockPos,
  ProfileSchema,
  ProviderKindSchema,
  SandboxCreateRequestSchema,
  WorldKindSchema,
} from "@shepherdjerred/mc-harness/protocol/ipc.ts";
import { parseAffects } from "@shepherdjerred/mc-harness/protocol/live.ts";
import { parseTtl } from "@shepherdjerred/unix-socket-daemon";
import { wantsHelp } from "@shepherdjerred/mc-harness/protocol/argv.ts";
import {
  DEFAULT_DAEMON_TTL_SECONDS,
  DEFAULT_SANDBOX_TTL_SECONDS,
} from "@shepherdjerred/mc-harness/protocol/paths.ts";

const COMMON = {
  target: { type: "string" },
  json: { type: "boolean", default: false },
  session: { type: "string", default: "agent" },
  ...LIVE_WRITE_OPTIONS,
} as const satisfies ParseArgsOptionsConfig;

function fail(message: string): never {
  console.error(`Error: ${message}`);
  console.error(MC_USAGE);
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
): TargetOptions {
  if (values.target === "") {
    fail("--target needs a sandbox id");
  }
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

function boxFrom(world: unknown, positionals: readonly string[]): Box {
  const [a, b] = positionals;
  if (a === undefined || b === undefined) {
    fail("two corners x1,y1,z1 x2,y2,z2 are required");
  }
  return BoxSchema.parse({
    world: requireString(world, "--world"),
    min: parseBlockPos(a),
    max: parseBlockPos(b),
  });
}

function intOption(raw: unknown, name: string, fallback: number): number {
  if (raw === undefined) {
    return fallback;
  }
  if (typeof raw !== "string" || !/^\d+$/u.test(raw)) {
    fail(`${name} must be a non-negative integer`);
  }
  return Number(raw);
}

async function handleDaemon(args: string[]): Promise<void> {
  const [action = "", ...rest] = args;
  const { values } = parse(rest, { ttl: { type: "string" } });
  switch (action) {
    case "start": {
      await mcDaemonStartCommand(
        values.ttl === undefined
          ? DEFAULT_DAEMON_TTL_SECONDS
          : parseTtl(values.ttl),
      );
      return;
    }
    case "stop": {
      await mcDaemonStopCommand();
      return;
    }
    case "status": {
      await mcDaemonStatusCommand(values.json);
      return;
    }
  }
  fail(`unknown daemon action "${action}"`);
}

async function handleSandbox(args: string[]): Promise<void> {
  const [action = "", ...rest] = args;
  const { values, positionals } = parse(rest, {
    profile: { type: "string", default: "paper" },
    world: { type: "string", default: "flat" },
    ttl: { type: "string" },
    keep: { type: "boolean", default: false },
    all: { type: "boolean", default: false },
    provider: { type: "string" },
  });
  switch (action) {
    case "up": {
      const request = SandboxCreateRequestSchema.parse({
        profile: ProfileSchema.parse(values.profile),
        world: WorldKindSchema.parse(values.world),
        ttlSeconds:
          values.ttl === undefined
            ? DEFAULT_SANDBOX_TTL_SECONDS
            : parseTtl(values.ttl),
        keep: values.keep,
        ...(values.provider === undefined
          ? {}
          : { provider: ProviderKindSchema.parse(values.provider) }),
      });
      await mcSandboxUpCommand(request, values.json);
      return;
    }
    case "ls": {
      await mcSandboxListCommand(values.json);
      return;
    }
    case "down": {
      if (!values.all && positionals.length === 0) {
        fail("sandbox down needs <id…> or --all");
      }
      if (positionals.includes("")) {
        fail("sandbox down got an empty sandbox id");
      }
      await mcSandboxDownCommand(positionals, values.all);
      return;
    }
  }
  fail(`unknown sandbox action "${action}"`);
}

async function handleWe(args: string[]): Promise<void> {
  const { values, positionals } = parse(args, {
    world: { type: "string" },
    pos1: { type: "string" },
    pos2: { type: "string" },
    at: { type: "string" },
    affects: { type: "string" },
    record: { type: "string" },
  });
  const command = positionals.join(" ");
  const world = requireString(values.world, "--world");
  const [a, b, ...extra] = values.affects?.split(":") ?? [];
  if (values.affects !== undefined && (b === undefined || extra.length > 0)) {
    fail("--affects must be x1,y1,z1:x2,y2,z2");
  }
  const affects =
    a === undefined || b === undefined ? undefined : parseAffects(world, a, b);
  const op = WeOpSchema.parse({
    command,
    ...(values.pos1 === undefined ? {} : { pos1: parseBlockPos(values.pos1) }),
    ...(values.pos2 === undefined ? {} : { pos2: parseBlockPos(values.pos2) }),
    ...(values.at === undefined ? {} : { at: parseBlockPos(values.at) }),
  });
  const options = targetOptions(values);
  await mcWeCommand(
    {
      ...options,
      write: { ...options.write, affects },
      session: SessionNameSchema.parse(values.session),
      world,
      record: values.record,
    },
    op,
  );
}

async function handlePaste(args: string[]): Promise<void> {
  const { values } = parse(args, {
    world: { type: "string" },
    file: { type: "string" },
    at: { type: "string" },
    rotate: { type: "string", default: "0" },
    "ignore-air": { type: "boolean", default: false },
    record: { type: "string" },
  });
  const rotate = Number(values.rotate);
  if (rotate !== 0 && rotate !== 90 && rotate !== 180 && rotate !== 270) {
    fail("--rotate must be 0, 90, 180 or 270");
  }
  await mcPasteCommand(
    {
      ...targetOptions(values),
      session: SessionNameSchema.parse(values.session),
      world: requireString(values.world, "--world"),
      record: values.record,
    },
    {
      file: requireString(values.file, "--file"),
      at: parseBlockPos(requireString(values.at, "--at")),
      rotate,
      ignoreAir: values["ignore-air"],
    },
  );
}

async function handleSnapshot(args: string[]): Promise<void> {
  const [action = "", ...rest] = args;
  const { values, positionals } = parse(rest, {
    world: { type: "string" },
    label: { type: "string" },
    out: { type: "string" },
  });
  const options = targetOptions(values);
  switch (action) {
    case "create": {
      await mcSnapshotCreateCommand(
        options,
        boxFrom(values.world, positionals),
        values.label,
      );
      return;
    }
    case "ls": {
      await mcSnapshotListCommand(options);
      return;
    }
    case "get": {
      await mcSnapshotGetCommand(
        options,
        requireString(positionals[0], "<id>"),
        requireString(values.out, "--out"),
      );
      return;
    }
    case "restore": {
      await mcSnapshotRestoreCommand(
        options,
        requireString(positionals[0], "<id>"),
      );
      return;
    }
  }
  fail(`unknown snapshot action "${action}"`);
}

async function handleTargetCommand(
  command: string,
  args: string[],
): Promise<boolean> {
  switch (command) {
    case "info": {
      const { values } = parse(args, {});
      await mcInfoCommand(targetOptions(values));
      return true;
    }
    case "players": {
      const { values } = parse(args, {});
      await mcPlayersCommand(targetOptions(values));
      return true;
    }
    case "registry": {
      const { values } = parse(args, { out: { type: "string" } });
      await mcRegistryCommand(
        targetOptions(values),
        requireString(values.out, "--out"),
      );
      return true;
    }
    case "cmd": {
      const { values, positionals } = parse(args, {
        record: { type: "string" },
      });
      if (positionals.length === 0) {
        fail("cmd needs a console command");
      }
      await mcCmdCommand(
        { ...targetOptions(values), record: values.record },
        positionals.join(" "),
      );
      return true;
    }
    case "we": {
      await handleWe(args);
      return true;
    }
    case "we-undo": {
      const { values } = parse(args, { steps: { type: "string" } });
      await mcWeUndoCommand(
        {
          ...targetOptions(values),
          session: SessionNameSchema.parse(values.session),
        },
        intOption(values.steps, "--steps", 1),
      );
      return true;
    }
    case "paste": {
      await handlePaste(args);
      return true;
    }
    case "region": {
      const [action = "", ...rest] = args;
      if (action !== "read") {
        fail(`unknown region action "${action}"`);
      }
      const { values, positionals } = parse(rest, {
        world: { type: "string" },
        out: { type: "string" },
      });
      await mcRegionReadCommand(
        targetOptions(values),
        boxFrom(values.world, positionals),
        values.out,
      );
      return true;
    }
    case "snapshot": {
      await handleSnapshot(args);
      return true;
    }
    case "events": {
      const { values } = parse(args, {
        since: { type: "string" },
        limit: { type: "string" },
      });
      await mcEventsCommand(
        targetOptions(values),
        intOption(values.since, "--since", 0),
        intOption(values.limit, "--limit", 200),
      );
      return true;
    }
    case "logs": {
      const { values } = parse(args, { n: { type: "string", short: "n" } });
      await mcLogsCommand(
        targetOptions(values),
        intOption(values.n, "-n", 200),
      );
      return true;
    }
  }
  return false;
}

export async function handleMcCommand(
  subcommand: string | undefined,
  args: string[],
): Promise<void> {
  try {
    if (subcommand !== undefined && wantsHelp(args)) {
      console.log(subcommandUsage(subcommand));
      return;
    }
    switch (subcommand) {
      case undefined:
      case "help":
      case "--help":
      case "-h": {
        console.log(MC_USAGE);
        return;
      }
      case "daemon": {
        await handleDaemon(args);
        return;
      }
      case "sandbox": {
        await handleSandbox(args);
        return;
      }
      case "build": {
        await mcBuildCommand(args);
        return;
      }
      case "actor": {
        await handleMcActor(args);
        return;
      }
      case "playtest": {
        await handleMcPlaytest(args);
        return;
      }
      case "live": {
        await handleMcLive(args);
        return;
      }
      case "client": {
        await handleMcClient(args);
        return;
      }
      case "files": {
        await handleMcFiles(args);
        return;
      }
    }
    if (!(await handleTargetCommand(subcommand, args))) {
      fail(`unknown mc command "${subcommand}"`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
