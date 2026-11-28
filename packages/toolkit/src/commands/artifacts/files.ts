import { usageError } from "#lib/artifacts/errors.ts";
import type { Runtime } from "./runtime.ts";

/** Reads a `--body-file` or `--note-file`: a path, or `-` for stdin. */
export async function readTextFile(
  runtime: Runtime,
  file: string,
  flag: string,
): Promise<string> {
  if (file === "-") return runtime.stdin();
  const handle = Bun.file(file);
  if (!(await handle.exists()))
    throw usageError(`${flag} ${file} does not exist.`);
  return handle.text();
}
