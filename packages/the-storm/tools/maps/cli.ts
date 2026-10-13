import { mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";

/** Create a fresh private output directory for a native map proof. */
export async function prepareOutputDirectory(): Promise<string> {
  const args = parseArgs({
    strict: true,
    options: { output: { type: "string" } },
  });
  const output = path.resolve(z.string().min(1).parse(args.values.output));
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(output, { recursive: false, mode: 0o700 });
  return output;
}
