// `toolkit mc files …`: read-only pulls of plugin data from a sandbox or live
// tsmc, plus rwf recording and bot-trace helpers.
import path from "node:path";
import type { ParseArgsOptionsConfig } from "node:util";
import {
  normalizeDataPath,
  READABLE_ROOTS,
  RwfKindSchema,
} from "@shepherdjerred/mc-harness/protocol/files.ts";
import {
  mcFilesGetCommand,
  mcFilesListCommand,
  mcRwfGetCommand,
  mcRwfListCommand,
} from "#commands/mc/files.ts";
import { resolveTarget } from "#lib/mc/target.ts";
import { parseMcArgs } from "./mc-args.ts";

export const FILES_USAGE = `Plugin data (read-only; paths under /data: ${READABLE_ROOTS};
live reads need no bridge token, only a running pod):
  toolkit mc files ls <path> [--target <id|live>] [--json]
  toolkit mc files get <path> [--out f] [--gunzip] [--force] [--target <id|live>]
  toolkit mc files rwf ls [<match-id>] [--target <id|live>] [--json]      Recordings and rwfbots traces, newest first
  toolkit mc files rwf get <match-id> [--kind recording|trace] [--out-dir .] [--gunzip] [--force]`;

const OPTIONS = {
  target: { type: "string" },
  json: { type: "boolean", default: false },
  out: { type: "string" },
  "out-dir": { type: "string" },
  kind: { type: "string", default: "recording" },
  gunzip: { type: "boolean", default: false },
  force: { type: "boolean", default: false },
} as const satisfies ParseArgsOptionsConfig;

function requirePositional(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`Error: ${name} is required`);
  }
  return value;
}

async function handleRwf(args: string[]): Promise<void> {
  const [action = "", ...rest] = args;
  const { values, positionals } = parseMcArgs(OPTIONS, rest, {});
  const target = await resolveTarget(values.target);
  switch (action) {
    case "ls": {
      await mcRwfListCommand({
        target,
        json: values.json,
        matchId: positionals[0],
      });
      return;
    }
    case "get": {
      const kind = RwfKindSchema.safeParse(values.kind);
      if (!kind.success) {
        throw new Error(
          `Error: --kind must be recording or trace, got ${values.kind}`,
        );
      }
      await mcRwfGetCommand({
        target,
        json: values.json,
        matchId: requirePositional(positionals[0], "<match-id>"),
        kind: kind.data,
        outDir: path.resolve(values["out-dir"] ?? "."),
        force: values.force,
        gunzip: values.gunzip,
      });
      return;
    }
  }
  throw new Error(`Error: unknown rwf action "${action}"; use ls or get`);
}

export async function handleMcFiles(args: string[]): Promise<void> {
  const [action = "", ...rest] = args;
  if (action === "rwf") {
    await handleRwf(rest);
    return;
  }
  const { values, positionals } = parseMcArgs(OPTIONS, rest, {});
  if (action !== "ls" && action !== "get") {
    throw new Error(
      `Error: unknown files action "${action}"; use ls, get or rwf`,
    );
  }
  // Validated before resolving the target, which may start the daemon.
  const source = normalizeDataPath(requirePositional(positionals[0], "<path>"));
  const target = await resolveTarget(values.target);
  if (action === "ls") {
    await mcFilesListCommand({ target, json: values.json, path: source });
    return;
  }
  await mcFilesGetCommand({
    target,
    json: values.json,
    path: source,
    out: values.out,
    force: values.force,
    gunzip: values.gunzip,
  });
}
