import type { Delivery } from "#infrastructure/delivery.ts";

/** Longest title kept. The table's CHECK and the migration's backfill use the same bound. */
export const TITLE_LIMIT = 200;

/** What an exact main push pipeline says about its commit. */
export type SourceCommitReport = {
  sourceRevision: string;
  /** The whole commit message. */
  message: string;
  /** Woodpecker's pipeline author: the forge account behind the push. */
  author: string;
  pipelineNumber: number;
};

/**
 * The leading code points of a line, up to the limit. PostgreSQL's
 * `char_length` and `left` count code points too, so the table's CHECK and
 * the backfill agree with it.
 */
const BOUNDED = new RegExp(`^.{0,${String(TITLE_LIMIT)}}`, "su");

/** A commit's title: the first line of its message, trimmed and bounded; null when empty. */
export function commitTitle(message: string): string | null {
  const [line = ""] = message.split("\n", 1);
  const title = BOUNDED.exec(line.trim())?.[0];
  return title === undefined || title === "" ? null : title;
}

/**
 * Keep a main commit's title and author for the hub. The first report wins: a
 * commit's message never changes, its first pipeline is the push itself, and
 * every build of a commit reports on every qualification attempt, so repeats
 * must cost one conflict-free statement and a later rerun must not rewrite who
 * pushed.
 */
export async function recordSourceCommit(
  this: Delivery,
  report: SourceCommitReport,
) {
  const author = report.author.trim();
  await this.database.sourceCommit.createMany({
    data: [
      {
        sourceRevision: report.sourceRevision,
        title: commitTitle(report.message),
        author: author === "" ? null : author,
        pipelineNumber: report.pipelineNumber,
      },
    ],
    skipDuplicates: true,
  });
}
