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
    case "press": {
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
      return;
    }
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
