import { parse } from "csv-parse/sync";
import type { z } from "zod";

export const KNOWLEDGE_FETCH_TIMEOUT_MS = 30_000;

async function fetchResponse(
  url: string,
  timeoutMs: number,
): Promise<Response> {
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "discord-plays-pokemon-knowledge-generator/1.0 (https://github.com/shepherdjerred/monorepo)",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`failed to fetch ${url}: ${String(response.status)}`);
  }
  return response;
}

export async function fetchText(
  url: string,
  timeoutMs = KNOWLEDGE_FETCH_TIMEOUT_MS,
): Promise<string> {
  const response = await fetchResponse(url, timeoutMs);
  return response.text();
}

export async function fetchJson(
  url: string,
  timeoutMs = KNOWLEDGE_FETCH_TIMEOUT_MS,
): Promise<unknown> {
  const response = await fetchResponse(url, timeoutMs);
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
