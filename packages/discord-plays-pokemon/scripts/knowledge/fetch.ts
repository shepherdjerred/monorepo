import { parse } from "csv-parse/sync";
import type { z } from "zod";

export async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "discord-plays-pokemon-knowledge-generator/1.0 (https://github.com/shepherdjerred/monorepo)",
    },
  });
  if (!response.ok) {
    throw new Error(`failed to fetch ${url}: ${String(response.status)}`);
  }
  return response.text();
}

export async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "discord-plays-pokemon-knowledge-generator/1.0 (https://github.com/shepherdjerred/monorepo)",
    },
  });
  if (!response.ok) {
    throw new Error(`failed to fetch ${url}: ${String(response.status)}`);
  }
  return response.json();
}

export async function fetchCsv<T>(
  url: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const source = await fetchText(url);
  const parsed: unknown = parse(source, {
    columns: true,
    skip_empty_lines: true,
  });
  return schema.parse(parsed);
}
