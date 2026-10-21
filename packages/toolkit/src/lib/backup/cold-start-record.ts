import { open } from "node:fs/promises";

export type ColdStartRecordLine = Record<string, unknown>;

/**
 * Create the cold-start record exclusively; an existing file is never
 * replaced. It lists every restored production object key and checksum, so it
 * is readable by the invoking user only.
 */
export async function openColdStartRecord(
  path: string,
  header: ColdStartRecordLine,
) {
  const handle = await open(path, "wx", 0o600);
  const append = (line: ColdStartRecordLine) =>
    handle.appendFile(`${JSON.stringify(line)}\n`);
  await append(header);
  return { append, close: () => handle.close() };
}
