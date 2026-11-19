import { parseArgs } from "node:util";
import { z } from "zod";
import {
  readFrozenPlayback,
  readFrozenPlaybackBytes,
} from "#migration/personal-state/frozen-playback.ts";

async function stdinImage() {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of Bun.stdin.stream()) {
    size += chunk.byteLength;
    if (size > 256 * 1024 * 1024)
      throw new Error("Frozen SQLite exceeds bounded image size");
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

if (import.meta.main) {
  try {
    const { values } = parseArgs({
      options: {
        sqlite: { type: "string" },
        "wal-settled": { type: "boolean", default: false },
      },
    });
    if (values.sqlite === "-" && !values["wal-settled"])
      throw new Error("Stdin requires independently verified settled WAL");
    const result =
      values.sqlite === "-"
        ? readFrozenPlaybackBytes(await stdinImage())
        : await readFrozenPlayback(z.string().min(1).parse(values.sqlite));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch {
    console.error(
      "Frozen playback read failed. Use the stopped writer's intact SQLite snapshot with zero active sessions; no writes were performed.",
    );
    process.exitCode = 1;
  }
}
