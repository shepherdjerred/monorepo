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
    "  pokemonctl memory show",
    '  pokemonctl memory write "<markdown>"',
    '  pokemonctl session write "<markdown>"',
    "  pokemonctl session list [--limit n]",
    '  pokemonctl session search "<query>" [--limit n]',
    "  pokemonctl session read <id>",
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

// Body text for `memory write` / `session write`. Prefer a single quoted
// argument (newlines preserved); fall back to stdin so long markdown can be
// heredoc-piped.
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

// Split out of main() so its switch stays under the complexity cap.
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

// `pokemonctl memory <show|write …>`. Split out of main() to keep its complexity
// in check and avoid a non-exhaustive inner switch.
async function handleMemory(args: string[]): Promise<void> {
  const sub = args.at(0);
  if (sub === "show") {
    printJsonText(await request("GET", "/memory"));
    return;
  }
  if (sub === "write") {
    const content = await readContentArg(args.slice(1));
    printJsonText(await request("POST", "/memory", { content }));
    return;
  }
  throw new Error(`unknown memory subcommand: ${String(sub)}\n${usage()}`);
}

// `pokemonctl session <list|search|read|write …>`.
async function handleSession(args: string[]): Promise<void> {
  const sub = args.at(0);
  if (sub === "list") {
    const limit = readNumberFlag(args, "--limit");
    const route =
      limit === undefined ? "/sessions" : `/sessions?limit=${String(limit)}`;
    printJsonText(await request("GET", route));
    return;
  }
  if (sub === "search") {
    const query = args.at(1);
    if (query === undefined || query.startsWith("--")) {
      throw new Error(
        'session search requires a query, e.g. session search "warp arrow"',
      );
    }
    const limit = readNumberFlag(args, "--limit");
    const params = new URLSearchParams({ q: query });
    if (limit !== undefined) {
      params.set("limit", String(limit));
    }
    printJsonText(
      await request("GET", `/sessions/search?${params.toString()}`),
    );
    return;
  }
  if (sub === "read") {
    const id = args.at(1);
    if (id === undefined) {
      throw new Error("session read requires an id (see session list)");
    }
    const params = new URLSearchParams({ id });
    printJsonText(await request("GET", `/sessions/read?${params.toString()}`));
    return;
  }
  if (sub === "write") {
    const content = await readContentArg(args.slice(1));
    printJsonText(await request("POST", "/sessions", { content }));
    return;
  }
  throw new Error(`unknown session subcommand: ${String(sub)}\n${usage()}`);
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, undefined, 2)}\n`);
}

function printJsonText(value: string): void {
  process.stdout.write(`${value}\n`);
}

async function main(): Promise<void> {
  const command = Bun.argv.at(2);
  const args = Bun.argv.slice(3);
  switch (command) {
    case "screenshot":
      printJsonText(await request("POST", "/screenshot"));
      return;
    case "status":
      printJsonText(await request("GET", "/status"));
      return;
    case "state":
      printJsonText(await request("GET", "/state"));
      return;
    case "history": {
      const limit = readNumberFlag(args, "--limit");
      const route =
        limit === undefined ? "/history" : `/history?limit=${String(limit)}`;
      printJsonText(await request("GET", route));
      return;
    }
    case "press":
      await handlePress(args);
      return;
    case "chord": {
      const value = args.at(0);
      if (value === undefined) {
        throw new Error("chord requires a command string");
      }
      printJsonText(await request("POST", "/chord", { value }));
      return;
    }
    case "wait": {
      const seconds = readNumberFlag(args, "--seconds");
      if (seconds === undefined) {
        throw new Error("wait requires --seconds");
      }
      await Bun.sleep(seconds * 1000);
      printJson({ ok: true, waitedSeconds: seconds });
      return;
    }
    case "progress": {
      const message = args.join(" ").trim();
      if (message.length === 0) {
        throw new Error("progress requires a message");
      }
      printJsonText(await request("POST", "/progress", { message }));
      return;
    }
    case "memory":
      await handleMemory(args);
      return;
    case "session":
      await handleSession(args);
      return;
    case undefined:
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(`${usage()}\n`);
      return;
    default:
      throw new Error(`unknown command: ${command}\n${usage()}`);
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
