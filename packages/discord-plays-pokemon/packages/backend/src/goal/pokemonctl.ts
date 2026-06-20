#!/usr/bin/env bun

type RequestBody = Record<string, unknown>;

function usage(): string {
  return [
    "Usage:",
    "  pokemonctl screenshot",
    "  pokemonctl press <button> [--quantity n] [--hold-ms n]",
    '  pokemonctl chord "<commands>"',
    "  pokemonctl wait --seconds n",
    "  pokemonctl status",
    "  pokemonctl state",
    "  pokemonctl history [--limit n]",
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

async function request(
  method: "GET" | "POST",
  route: string,
  body?: RequestBody,
): Promise<string> {
  const baseUrl = readRequiredEnv("POKEMONCTL_URL");
  const token = readRequiredEnv("POKEMONCTL_TOKEN");
  const response = await fetch(new URL(route, baseUrl), {
    method,
    headers: {
      authorization: `Bearer ${token}`,
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

// Body text for `write`. Prefer a single quoted argument (newlines preserved);
// fall back to stdin so long markdown can be heredoc-piped.
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

async function handlePress(args: string[]): Promise<void> {
  const button = args.at(0);
  if (button === undefined) {
    throw new Error("press requires a button");
  }
  const quantity = readNumberFlag(args, "--quantity");
  const holdMs = readNumberFlag(args, "--hold-ms");
  printJsonText(
    await request("POST", "/press", {
      command: button,
      ...(quantity === undefined ? {} : { quantity }),
      ...(holdMs === undefined ? {} : { holdMs }),
    }),
  );
}

async function handleChord(args: string[]): Promise<void> {
  const value = args.at(0);
  if (value === undefined) {
    throw new Error("chord requires a command string");
  }
  printJsonText(await request("POST", "/chord", { value }));
}

async function handleWait(args: string[]): Promise<void> {
  const seconds = readNumberFlag(args, "--seconds");
  if (seconds === undefined) {
    throw new Error("wait requires --seconds");
  }
  await Bun.sleep(seconds * 1000);
  printJson({ ok: true, waitedSeconds: seconds });
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

// ── Scoped memory filesystem (LIST / READ / GREP / WRITE). ────────────────────

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
  ["press", handlePress],
  ["chord", handleChord],
  ["wait", handleWait],
  ["progress", handleProgress],
  ["list", handleList],
  ["read", handleRead],
  ["grep", handleGrep],
  ["write", handleWrite],
]);

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
