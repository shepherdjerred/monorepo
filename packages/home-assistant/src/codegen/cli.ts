#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { emitSchemaModule } from "./emit.js";
import { introspect } from "./introspect.js";

type CliArgs = {
  url: string;
  token: string;
  out: string;
  name: string;
  help: boolean;
};

const HELP_TEXT = `
ha-codegen - Generate a typed Home Assistant schema from a live instance

USAGE:
  HA_TOKEN=<long-lived-access-token> ha-codegen --url <base-url> --out <path> [options]

OPTIONS:
  --url <base-url>       Home Assistant base URL (defaults to HA_URL)
  --out <path>           Generated TypeScript module path (required)
  --name <schema-name>   Generated schema type name (default: HaSchema)
  --help, -h             Show this help message

The generated module contains entity IDs and service definitions from your
instance. Treat it as private: gitignore it and regenerate it when needed.
`;

function parseArgs(argv: string[]): CliArgs {
  const map = new Map<string, string>();
  let help = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    const key = parseOptionKey(arg);
    const next = argv[i + 1];
    if (next?.startsWith("--") !== false) {
      map.set(key, "true");
      continue;
    }
    map.set(key, next);
    i += 1;
  }
  const url = map.get("url") ?? environmentValue("HA_URL");
  const token = environmentValue("HA_TOKEN");
  const out = map.get("out");
  const name = map.get("name") ?? "HaSchema";
  if (help) {
    return { url: "", token: "", out: "", name: "HaSchema", help: true };
  }
  if (url === undefined || url === "") {
    fail("Missing --url (or HA_URL env var)");
  }
  if (token === undefined || token === "") {
    fail("Missing HA_TOKEN environment variable");
  }
  if (out === undefined || out === "") {
    fail("Missing --out <path>");
  }
  return { url, token, out, name, help: false };
}

function parseOptionKey(arg: string | undefined): "url" | "out" | "name" {
  if (arg?.startsWith("--") !== true) {
    fail(`Unexpected argument: ${arg ?? ""}`);
  }
  const key = arg.slice(2);
  if (key !== "url" && key !== "out" && key !== "name") {
    fail(`Unknown option: ${arg}`);
  }
  return key;
}

function environmentValue(name: string): string | undefined {
  return globalThis.process.env[name];
}

function fail(message: string): never {
  console.error(`ha-codegen: ${message}`);
  console.error(
    "Usage: ha-codegen --url <base-url> --out <path> [--name <SchemaName>]",
  );
  process.exit(2);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP_TEXT);
    return;
  }
  const intro = await introspect(args.url, args.token);
  const sourceHost = safeHost(args.url);
  const module = emitSchemaModule(intro, {
    schemaName: args.name,
    sourceHost,
    generatedAt: new Date().toISOString(),
  });
  const outPath = path.resolve(args.out);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, module, "utf8");
  console.warn(
    `ha-codegen: wrote ${String(intro.states.length)} entities, ` +
      `${String(totalServices(intro))} services, ` +
      `${String(intro.events.length)} event types → ${outPath}`,
  );
}

function totalServices(intro: {
  services: { services: Record<string, unknown> }[];
}): number {
  let n = 0;
  for (const entry of intro.services) {
    n += Object.keys(entry.services).length;
  }
  return n;
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "<unparsed>";
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`ha-codegen: ${message}`);
  process.exit(1);
}
