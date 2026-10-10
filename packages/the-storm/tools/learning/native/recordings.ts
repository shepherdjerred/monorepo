import { readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { DuelState } from "#learning/duels.ts";
import { digestFile } from "#learning/preference/ledger.ts";
import { run } from "#learning/preference/media.ts";
import { root } from "#learning/sandbox.ts";

/** Parse complete original schema-3 bot-only Trooper records after graceful Paper export. */
export async function originalRecordings(output: string, states: DuelState[]) {
  if (new Set(states.map((state) => state.match)).size !== states.length)
    throw new Error("Native captures reuse an original match identity");
  const directory = path.join(output, "recordings");
  const files = await readdir(directory, { recursive: true });
  const recordings = await Promise.all(
    states.map(async (state) => {
      const matching = files.filter((name) =>
        name.endsWith(`/${state.match}.rwfrec.gz`),
      );
      if (matching.length !== 1 || matching[0] === undefined)
        throw new Error(
          "Original native model recording is missing or duplicated",
        );
      const file = path.join(directory, matching[0]);
      return {
        file,
        sha256: await digestFile(file),
        match: state.match,
        seed: state.seed,
      };
    }),
  );
  const raw = await Promise.all(
    recordings.map(
      async (recording) =>
        z
          .array(z.unknown())
          .length(1)
          .parse(
            JSON.parse(
              await run([
                "uv",
                "run",
                "--project",
                path.join(root, "tools/learning"),
                "--locked",
                "python",
                path.join(
                  root,
                  "scripts/bots/learning/preference_recording.py",
                ),
                "--expected-seed",
                recording.seed.toString(),
                recording.file,
              ]),
            ),
          )[0],
    ),
  );
  const parsed = z
    .array(
      z.strictObject({
        match: z.uuid(),
        map_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
        winner: z.enum(["RED", "BLUE", "-"]),
        reason: z.enum(["LAST_TEAM_STANDING", "DRAW", "STOPPED"]),
      }),
    )
    .length(states.length)
    .parse(raw);
  for (const [index, record] of parsed.entries()) {
    const state = states[index];
    const source = recordings[index];
    if (
      state === undefined ||
      source === undefined ||
      record.match !== state.match
    )
      throw new Error("Native model recording identity differs");
    const won = record.winner.toLowerCase() === state.side;
    if (
      (!won && state.result === "win") ||
      (state.result === "loss" && (won || record.winner === "-")) ||
      (["draw", "timeout"].includes(state.result) && record.winner !== "-") ||
      (await digestFile(source.file)) !== source.sha256
    )
      throw new Error(
        "Original native model recording outcome or bytes changed",
      );
  }
  if (new Set(parsed.map((record) => record.map_sha256)).size !== 1)
    throw new Error("Native model footage uses different terrain");
  return recordings;
}
