import { open } from "node:fs/promises";

/** Only the owned unclaimed fixture's bounded error tail; credential-bearing lines are never retained. */
export async function pmsStartupErrors(file: string): Promise<string[]> {
  const handle = await open(file, "r");
  try {
    const stat = await handle.stat();
    const length = Math.min(stat.size, 65_536);
    const offset = stat.size - length;
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    // A partial first line may have lost its credential marker; discard it in full.
    const lines = text.split(/\r?\n/u).slice(offset === 0 ? 0 : 1);
    return lines
      .filter(
        (line) =>
          /\b(?:WARN|ERROR)\b/u.test(line) &&
          !/token|authorization|cookie|password|secret|credential|https?:\/\/\S*[@?]/iu.test(
            line,
          ),
      )
      .slice(-16)
      .map((line) => line.slice(0, 1024));
  } finally {
    await handle.close();
  }
}
