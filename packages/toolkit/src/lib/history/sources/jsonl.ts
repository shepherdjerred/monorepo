import { parseRecord } from "#lib/history/query/text.ts";
import type { UsageFieldLocation } from "#lib/history/usage-cost.ts";

export type JsonLine = {
  readonly record: Record<string, unknown> | null;
  readonly location: UsageFieldLocation;
};

async function* textLines(filePath: string): AsyncGenerator<string> {
  const chunks = Bun.file(filePath)
    .stream()
    .pipeThrough(new TextDecoderStream());
  let pending = "";
  for await (const chunk of chunks) {
    const parts = `${pending}${chunk}`.split("\n");
    pending = parts.pop() ?? "";
    yield* parts;
  }
  if (pending.length > 0) {
    yield pending;
  }
}

/**
 * Streams a JSONL transcript one record at a time, so a multi-megabyte
 * session log is never held in memory as one string. A line that fails to
 * parse is truncated or corrupt and fails the read: skipping it would let a
 * scan report success with a quietly shrunken usage total. The error names
 * only the file and line number, never the line, which can carry arbitrary
 * conversation text. A line that parses to a non-object yields
 * `record: null` for the caller to decide.
 */
export async function* jsonLines(
  source: string,
  filePath: string,
): AsyncGenerator<JsonLine> {
  let lineNumber = 0;
  for await (const line of textLines(filePath)) {
    lineNumber += 1;
    if (line.trim().length === 0) {
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch (error) {
      throw new Error(
        `Malformed ${source} transcript line ${String(lineNumber)} in ${filePath}`,
        { cause: error },
      );
    }
    yield { record: parseRecord(value), location: { filePath, lineNumber } };
  }
}

export type TimestampContext = {
  readonly source: string;
  readonly label: string;
  readonly location: UsageFieldLocation;
};

/**
 * An epoch timestamp in `unitsPerMs` units (1 for milliseconds, 1000 for
 * microseconds) as an ISO instant. Zero, negative, fractional, and unsafe
 * values are not real timestamps and throw, since a manufactured 1970 date
 * would silently move usage out of every `--since` window.
 */
export function epochTimestamp(
  value: unknown,
  unitsPerMs: number,
  context: TimestampContext,
): string {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    const { source, label, location } = context;
    throw new TypeError(
      `${source} ${label} has a missing or invalid timestamp on line ${String(location.lineNumber)} in ${location.filePath}`,
    );
  }
  return new Date(Math.floor(value / unitsPerMs)).toISOString();
}

/** A file's modification time, for documents whose log has no timestamps. */
export async function modifiedAt(filePath: string): Promise<string> {
  const info = await Bun.file(filePath).stat();
  return new Date(info.mtimeMs).toISOString();
}
