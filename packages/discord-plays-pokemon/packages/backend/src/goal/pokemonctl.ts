#!/usr/bin/env bun

import { verifyPokemonctlCapabilities } from "./goal-capabilities.ts";
import { handlePokemonctlBattle } from "./pokemonctl-battle.ts";
import {
  formatPokemonctlActionOutput,
  formatPokemonctlObservationOutput,
} from "./pokemonctl-output.ts";

type RequestBody = Record<string, unknown>;

function usage(): string {
  return [
    "Usage:",
    "  pokemonctl observe [--screenshot] [--full]  # compact by default; --full includes detailed state",
    "  pokemonctl tap <button> [--repeat n] [--full]",
    "  pokemonctl move <north|south|west|east> [--tiles n] [--full]",
    "  pokemonctl map show [--radius n]",
    "  pokemonctl map exits",
    "  pokemonctl navigate --x n --y n [--max-steps n] [--radius n] [--full]  # current map only",
    "  pokemonctl navigate --exit <connection:n|warp:n> [--max-steps n] [--full]",
    "  pokemonctl battle move <1|2|3|4|exact-name> [--target-battler n] [--full]",
    "  pokemonctl battle run [--full]",
    "  pokemonctl battle item <id|exact-name> [--party-slot n] [--full]",
    "  pokemonctl battle switch <party-slot> [--full]",
    "  pokemonctl battle target <battler|party-slot> <n> [--full]",
    "  pokemonctl interact [north|south|west|east|ahead] [--full]",
    "  pokemonctl advance [--full]  # one scripted-dialog step",
    "  pokemonctl wait --until <ready|stable|phase-change> [--timeout-ms n] [--full]",
    "  pokemonctl screenshot",
    "  pokemonctl press <button> [--quantity n] [--hold-ms n] [--full]",
    '  pokemonctl chord "<commands>" [--full]',
    "  pokemonctl wait --seconds n  # compatibility delay",
    "  pokemonctl status",
    "  pokemonctl state",
    "  pokemonctl history [--limit n]",
    '  pokemonctl knowledge search "<query>" [--domain <domain>] [--limit n]',
    "  pokemonctl knowledge get <record-id>",
    '  pokemonctl progress "message"',
    "  pokemonctl list [path]",
    "  pokemonctl read <path>",
    '  pokemonctl grep "<pattern>" [path]',
    '  pokemonctl write MEMORY.md "<content>"',
  ].join("\n");
}

function readRequiredEnv(name: string): string {
  const value = Bun.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

function readNumberFlag(args: string[], name: string): number | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  const raw = args.at(index + 1);
  if (raw === undefined) {
    throw new Error(`${name} requires a value`);
  }

  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return value;
}

function readIntegerFlag(args: string[], name: string): number | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const raw = args.at(index + 1);
  if (raw === undefined) {
    throw new Error(`${name} requires a value`);
  }
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new TypeError(`${name} must be an integer`);
  }
  return value;
}

async function request(
  method: "GET" | "POST",
  route: string,
  body?: RequestBody,
): Promise<string> {
  const baseUrl = readRequiredEnv("POKEMONCTL_URL");
  const token = readRequiredEnv("POKEMONCTL_TOKEN");
  const goalId = readRequiredEnv("POKEMONCTL_GOAL_ID");
  const response = await fetch(new URL(route, baseUrl), {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "x-pokemon-goal-id": goalId,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `pokemonctl request failed (${String(response.status)}): ${text}`,
    );
  }
  return text.length > 0 ? text : "null";
}

async function readContentArg(parts: string[]): Promise<string> {
  const joined = parts.join(" ").trim();
  if (joined.length > 0) {
    return joined;
  }
  const raw = await Bun.stdin.text();
  const stdin = raw.trim();
  if (stdin.length === 0) {
    throw new Error(
      "content required (pass a quoted argument or pipe markdown via stdin)",
    );
  }
  return stdin;
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, undefined, 2)}\n`);
}

function printJsonText(value: string): void {
  process.stdout.write(`${value}\n`);
}

function printActionText(value: string, args: string[]): void {
  printJsonText(formatPokemonctlActionOutput(value, args.includes("--full")));
}

async function handlePress(args: string[]): Promise<void> {
  const button = args.at(0);
  if (button === undefined) {
    throw new Error("press requires a button");
  }
  const quantity = readNumberFlag(args, "--quantity");
  const holdMs = readNumberFlag(args, "--hold-ms");
  printActionText(
    await request("POST", "/press", {
      command: button,
      ...(quantity === undefined ? {} : { quantity }),
      ...(holdMs === undefined ? {} : { holdMs }),
    }),
    args,
  );
}

async function handleObserve(args: string[]): Promise<void> {
  const params = new URLSearchParams();
  if (args.includes("--screenshot")) params.set("screenshot", "true");
  const query = params.size === 0 ? "" : `?${params.toString()}`;
  printJsonText(
    formatPokemonctlObservationOutput(
      await request("GET", `/observe${query}`),
      args.includes("--full"),
    ),
  );
}

async function handleTap(args: string[]): Promise<void> {
  const button = args.at(0);
  if (button === undefined) {
    throw new Error("tap requires a button");
  }
  const repeat = readNumberFlag(args, "--repeat") ?? 1;
  printActionText(
    await request("POST", "/tap", { command: button, repeat }),
    args,
  );
}

function normalizeDirection(value: string): string {
  switch (value.toLowerCase()) {
    case "north":
    case "up":
    case "u":
      return "north";
    case "south":
    case "down":
    case "d":
      return "south";
    case "west":
    case "left":
    case "l":
      return "west";
    case "east":
    case "right":
    case "r":
      return "east";
    default:
      throw new Error(`invalid direction: ${value}`);
  }
}

async function handleMove(args: string[]): Promise<void> {
  const rawDirection = args.at(0);
  if (rawDirection === undefined) {
    throw new Error("move requires a direction");
  }
  const direction = normalizeDirection(rawDirection);
  const tiles = readNumberFlag(args, "--tiles") ?? 1;
  printActionText(await request("POST", "/move", { direction, tiles }), args);
}

async function handleMap(args: string[]): Promise<void> {
  const operation = args.at(0);
  if (operation === "exits") {
    const unexpected = args.at(1);
    if (unexpected !== undefined) {
      throw new Error(`map exits does not accept arguments: ${unexpected}`);
    }
    printJsonText(await request("GET", "/map/exits"));
    return;
  }
  if (operation !== "show") {
    throw new Error("map requires the show or exits subcommand");
  }
  const radius = readNumberFlag(args, "--radius") ?? 8;
  const params = new URLSearchParams({ radius: String(radius) });
  printJsonText(await request("GET", `/map?${params.toString()}`));
}

async function handleNavigate(args: string[]): Promise<void> {
  const x = readIntegerFlag(args, "--x");
  const y = readIntegerFlag(args, "--y");
  const exitId = readStringFlag(args, "--exit");
  const maxSteps = readNumberFlag(args, "--max-steps") ?? 64;
  if (exitId !== undefined) {
    if (x !== undefined || y !== undefined || args.includes("--radius")) {
      throw new Error(
        "navigate --exit cannot be combined with --x, --y, or --radius",
      );
    }
    if (!/^(?:connection|warp):(?:0|[1-9]\d*)$/u.test(exitId)) {
      throw new Error(
        "--exit must be a stable id from map exits (connection:n or warp:n)",
      );
    }
    printActionText(
      await request("POST", "/navigate", { exitId, maxSteps }),
      args,
    );
    return;
  }
  if (x === undefined || y === undefined) {
    throw new Error(
      "navigate requires either --exit or both --x and --y integer coordinates",
    );
  }
  const searchRadius = readNumberFlag(args, "--radius") ?? 12;
  printActionText(
    await request("POST", "/navigate", {
      x,
      y,
      maxSteps,
      searchRadius,
    }),
    args,
  );
}

async function handleBattle(args: string[]): Promise<void> {
  await handlePokemonctlBattle(
    {
      request,
      printActionText,
      readIntegerFlag,
      readNumberFlag,
    },
    args,
  );
}

async function handleInteract(args: string[]): Promise<void> {
  const rawDirection = args.find((value) => !value.startsWith("--"));
  const direction =
    rawDirection === undefined || rawDirection === "ahead"
      ? undefined
      : normalizeDirection(rawDirection);
  printActionText(
    await request("POST", "/interact", {
      ...(direction === undefined ? {} : { direction }),
    }),
    args,
  );
}

async function handleAdvance(args: string[]): Promise<void> {
  const unexpected = args.find((value) => value !== "--full");
  if (unexpected !== undefined) {
    throw new Error(`advance does not accept arguments: ${unexpected}`);
  }
  printActionText(await request("POST", "/advance", {}), args);
}

async function handleChord(args: string[]): Promise<void> {
  const value = args.at(0);
  if (value === undefined) {
    throw new Error("chord requires a command string");
  }
  printActionText(await request("POST", "/chord", { value }), args);
}

async function handleWait(args: string[]): Promise<void> {
  const seconds = readNumberFlag(args, "--seconds");
  if (seconds !== undefined) {
    await Bun.sleep(seconds * 1000);
    printJson({ ok: true, waitedSeconds: seconds });
    return;
  }
  const untilIndex = args.indexOf("--until");
  const until = args.at(untilIndex + 1);
  if (
    untilIndex === -1 ||
    (until !== "ready" && until !== "stable" && until !== "phase-change")
  ) {
    throw new Error("wait requires --until ready, stable, or phase-change");
  }
  const timeoutMs = readNumberFlag(args, "--timeout-ms") ?? 10_000;
  const maxFrames = Math.max(1, Math.round(timeoutMs / (1000 / 59.7275)));
  printActionText(await request("POST", "/wait", { until, maxFrames }), args);
}

async function handleHistory(args: string[]): Promise<void> {
  const limit = readNumberFlag(args, "--limit");
  const route =
    limit === undefined ? "/history" : `/history?limit=${String(limit)}`;
  printJsonText(await request("GET", route));
}

async function handleProgress(args: string[]): Promise<void> {
  const message = args.join(" ").trim();
  if (message.length === 0) {
    throw new Error("progress requires a message");
  }
  printJsonText(await request("POST", "/progress", { message }));
}

function readStringFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = args.at(index + 1);
  if (value === undefined) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

async function handleKnowledge(args: string[]): Promise<void> {
  const operation = args.at(0);
  const value = args.at(1);
  if (operation === "search") {
    if (value === undefined || value.startsWith("--")) {
      throw new Error("knowledge search requires a query");
    }
    const domain = readStringFlag(args, "--domain");
    const limit = readNumberFlag(args, "--limit");
    const params = new URLSearchParams({ q: value });
    if (domain !== undefined) params.set("domain", domain);
    if (limit !== undefined) params.set("limit", String(limit));
    printJsonText(
      await request("GET", `/knowledge/search?${params.toString()}`),
    );
    return;
  }
  if (operation === "get") {
    if (value === undefined || value.startsWith("--")) {
      throw new Error("knowledge get requires a record id");
    }
    printJsonText(
      await request(
        "GET",
        `/knowledge/get?${new URLSearchParams({ id: value }).toString()}`,
      ),
    );
    return;
  }
  throw new Error("knowledge requires search or get");
}

async function handleList(args: string[]): Promise<void> {
  const target = args.at(0);
  const route =
    target === undefined
      ? "/list"
      : `/list?${new URLSearchParams({ path: target }).toString()}`;
  printJsonText(await request("GET", route));
}

async function handleRead(args: string[]): Promise<void> {
  const target = args.at(0);
  if (target === undefined) {
    throw new Error("read requires a path (e.g. read MEMORY.md)");
  }
  printJsonText(
    await request(
      "GET",
      `/read?${new URLSearchParams({ path: target }).toString()}`,
    ),
  );
}

async function handleGrep(args: string[]): Promise<void> {
  const pattern = args.at(0);
  if (pattern === undefined) {
    throw new Error('grep requires a pattern (e.g. grep "warp arrow")');
  }
  const params = new URLSearchParams({ q: pattern });
  const target = args.at(1);
  if (target !== undefined && !target.startsWith("--")) {
    params.set("path", target);
  }
  printJsonText(await request("GET", `/grep?${params.toString()}`));
}

async function handleWrite(args: string[]): Promise<void> {
  const target = args.at(0);
  if (target === undefined) {
    throw new Error("write requires a path (only MEMORY.md is writable)");
  }
  const content = await readContentArg(args.slice(1));
  printJsonText(await request("POST", "/write", { path: target, content }));
}

const HANDLERS = new Map<string, (args: string[]) => Promise<void>>([
  ["observe", handleObserve],
  ["tap", handleTap],
  ["move", handleMove],
  ["map", handleMap],
  ["navigate", handleNavigate],
  ["battle", handleBattle],
  ["interact", handleInteract],
  ["advance", handleAdvance],
  [
    "screenshot",
    async () => {
      printJsonText(await request("POST", "/screenshot"));
    },
  ],
  [
    "status",
    async () => {
      printJsonText(await request("GET", "/status"));
    },
  ],
  [
    "state",
    async () => {
      printJsonText(await request("GET", "/state"));
    },
  ],
  ["history", handleHistory],
  ["knowledge", handleKnowledge],
  ["press", handlePress],
  ["chord", handleChord],
  ["wait", handleWait],
  ["progress", handleProgress],
  ["list", handleList],
  ["read", handleRead],
  ["grep", handleGrep],
  ["write", handleWrite],
]);
verifyPokemonctlCapabilities(new Set(HANDLERS.keys()));

async function main(): Promise<void> {
  const command = Bun.argv.at(2);
  if (
    command === undefined ||
    command === "help" ||
    command === "--help" ||
    command === "-h"
  ) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const handler = HANDLERS.get(command);
  if (handler === undefined) {
    throw new Error(`unknown command: ${command}\n${usage()}`);
  }
  await handler(Bun.argv.slice(3));
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
