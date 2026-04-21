#!/usr/bin/env bun
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { emitSchemaModule } from "./emit.ts";
import { introspect } from "./introspect.ts";

type CliArgs = {
  url: string;
  token: string;
  out: string;
  name: string;
};

function parseArgs(argv: string[]): CliArgs {
  const map = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg?.startsWith("--") !== true) {
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next?.startsWith("--") !== false) {
      map.set(key, "true");
      continue;
    }
    map.set(key, next);
    i += 1;
  }
  const url = map.get("url") ?? Bun.env["HA_URL"];
  const token = map.get("token") ?? Bun.env["HA_TOKEN"];
  const out = map.get("out");
  const name = map.get("name") ?? "HaSchema";
  if (url === undefined || url === "") {
    fail("Missing --url (or HA_URL env var)");
  }
  if (token === undefined || token === "") {
    fail("Missing --token (or HA_TOKEN env var)");
  }
  if (out === undefined || out === "") {
    fail("Missing --out <path>");
  }
  return { url, token, out, name };
}

function fail(message: string): never {
  console.error(`ha-codegen: ${message}`);
  console.error(
    "Usage: ha-codegen --url <base-url> --token <token> --out <path> [--name <SchemaName>]",
  );
  process.exit(2);
}

async function main(): Promise<void> {
  const args = parseArgs(Bun.argv.slice(2));
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
