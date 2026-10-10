import { readdir } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { jsonText, seal } from "#learning/preference/ledger.ts";

async function readLines(output: string, name: string): Promise<unknown[]> {
  const text = await Bun.file(path.join(output, name)).text();
  return text
    .trim()
    .split("\n")
    .map((row): unknown => JSON.parse(row));
}

async function originalRecording(output: string, match: string) {
  const files = await readdir(path.join(output, "recordings"), {
    recursive: true,
  });
  const originals = files.filter((file) =>
    file.endsWith(`/${match}.rwfrec.gz`),
  );
  if (originals.length !== 1 || originals[0] === undefined)
    throw new Error("Original regression recording missing or duplicated");
  return path.join(output, "recordings", originals[0]);
}

export async function regressionEvidence(output: string, match: string) {
  const file = await originalRecording(output, match);
  return {
    file,
    commands: await readLines(output, "commands.jsonl"),
    native: await readLines(output, "native-commands.jsonl"),
    recording: gunzipSync(await Bun.file(file).arrayBuffer()).toString("utf8"),
  };
}

/** A verifier failure stays sealed, but an unowned directory is never modified. */
export async function verifyOwned(
  output: string,
  ownership: { created: boolean },
  verify: () => Promise<void>,
) {
  try {
    await verify();
  } catch (error) {
    if (
      ownership.created &&
      !(await Bun.file(path.join(output, "failure.json")).exists())
    )
      await seal(
        path.join(output, "failure.json"),
        jsonText({
          schema: 1,
          acceptance: "unaccepted",
          diagnostic: true,
          retries: 0,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    throw error;
  }
}
