import type { CommitPipelineNote } from "#shared/hub/hub-contract.ts";
import type { Database } from "#infrastructure/database.ts";
import { CiRunSchema } from "#shared/hub/integration-contract.ts";
import { commitTitle } from "./source-commit.ts";

const StoredPipelineSchema = CiRunSchema.pick({
  number: true,
  author: true,
  message: true,
});

/**
 * For each commit whose record holds no title or no author (it predates
 * capture, or no build of it has been qualified since), what Woodpecker's
 * stored pipeline of one of its builds says. A commit with nothing stored
 * has no entry.
 */
export async function pipelineNotes(
  database: Database,
  builds: readonly { sourceRevision: string; pipelineNumber: number | null }[],
  recorded: ReadonlyMap<
    string,
    { title: string | null; author: string | null }
  >,
): Promise<Map<string, CommitPipelineNote>> {
  const numbers = new Map<string, number[]>();
  for (const build of builds) {
    const source = recorded.get(build.sourceRevision);
    if (source?.title != null && source.author != null) continue;
    if (build.pipelineNumber === null) continue;
    numbers.set(build.sourceRevision, [
      ...(numbers.get(build.sourceRevision) ?? []),
      build.pipelineNumber,
    ]);
  }
  const wanted = [...new Set([...numbers.values()].flat())];
  if (wanted.length === 0) return new Map();
  const snapshots = await database.integrationSnapshot.findMany({
    where: {
      source: "woodpecker",
      OR: wanted.map((number) => ({ key: { endsWith: `/${String(number)}` } })),
    },
  });
  const byNumber = new Map(
    snapshots.map((row) => {
      const run = StoredPipelineSchema.parse(row.payload);
      return [run.number, run] as const;
    }),
  );
  const notes = new Map<string, CommitPipelineNote>();
  for (const [sha, candidates] of numbers) {
    const run = candidates
      .map((number) => byNumber.get(number))
      .find((entry) => entry !== undefined);
    if (run === undefined) continue;
    const author = run.author.trim();
    notes.set(sha, {
      number: run.number,
      title: commitTitle(run.message),
      author: author === "" ? null : author,
    });
  }
  return notes;
}

/** The `pipeline` field of a commit status, present only when there is a note. */
export const withPipeline = (note: CommitPipelineNote | undefined) =>
  note === undefined ? {} : { pipeline: note };
