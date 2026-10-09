import { z } from "zod";
import {
  woodpeckerRequest,
  type WoodpeckerConfig,
} from "#lib/woodpecker/ci.ts";

const LogsSchema = z.array(
  z.object({ data: z.string().nullable(), line: z.number(), type: z.number() }),
);

export function decodeLogs(raw: unknown): string[] {
  return LogsSchema.parse(raw)
    .toSorted((a, b) => a.line - b.line)
    .flatMap((entry) => {
      if (entry.data === null) return [];
      if (
        !/^(?:[A-Z\d+/]{4})*(?:[A-Z\d+/]{2}==|[A-Z\d+/]{3}=)?$/i.test(
          entry.data,
        )
      )
        throw new Error("Invalid base64 in Woodpecker logs");
      return Buffer.from(entry.data, "base64").toString("utf8").split(/\r?\n/);
    });
}

/** Limit history collection to 8 MiB per step, including encoded log data. */
export async function boundedLogs(
  path: string,
  config: WoodpeckerConfig,
  signal?: AbortSignal,
): Promise<string[]> {
  const response = await woodpeckerRequest(path, config, signal);
  if (response.body === null) throw new Error("Woodpecker logs have no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = z.instanceof(Uint8Array).parse(result.value);
      size += chunk.byteLength;
      if (size > 8 * 1024 * 1024) throw new Error("Log evidence exceeds limit");
      chunks.push(chunk);
    }
    return decodeLogs(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
