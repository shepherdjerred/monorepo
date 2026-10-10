import { createHash } from "node:crypto";
import { lstat, open } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import {
  BUILD_FILES,
  JudgePairRecordSchema,
  type JudgeRecord,
} from "#protocol/build.ts";
import type { BuildWorkspace } from "#build/workspace.ts";
import { buildArtifactPath } from "#build/sidecar.ts";
import type { judgePair } from "#build/judge.ts";

type Verdict = Pick<
  Awaited<ReturnType<typeof judgePair>>,
  "winner" | "confidence" | "agreed" | "reasons"
>;
type Pair = Omit<
  Extract<JudgeRecord, { kind: "pair" }>,
  keyof Verdict | "kind" | "at"
>;

/** The attempt identity is checkpointed before judging; completed verdicts survive interrupted publication. */
export async function boutVerdict(
  workspace: BuildWorkspace,
  input: {
    attempt: string;
    incumbent: string;
    challenger: string;
    pair: Pair;
  },
  ask: () => Promise<Verdict>,
) {
  const key = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const parent = await buildArtifactPath(workspace, BUILD_FILES.judgeDir);
  const file = path.join(parent, `pair-bout-${key}.json`);
  const relative = path.join(BUILD_FILES.judgeDir, path.basename(file));
  let present = false;
  try {
    await lstat(file);
    present = true;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }
  if (present) {
    const record = JudgePairRecordSchema.parse(
      await Bun.file(await buildArtifactPath(workspace, relative)).json(),
    );
    const {
      kind: _kind,
      at: _at,
      winner: _winner,
      confidence: _confidence,
      agreed: _agreed,
      reasons: _reasons,
      ...pair
    } = record;
    if (!isDeepStrictEqual(pair, input.pair))
      throw new Error("persisted bout verdict does not match its inputs");
    return { record, file: relative };
  }
  const verdict = await ask();
  const record = JudgePairRecordSchema.parse({
    kind: "pair",
    at: new Date().toISOString(),
    ...input.pair,
    ...verdict,
  });
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return { record, file: relative };
}
