import { createHash } from "node:crypto";
import { DuckDBInstance } from "@duckdb/node-api";
import { z } from "zod";
import type { EmailIndexEntry } from "./types.ts";
import { extractTextBody } from "./parse.ts";
import { affinityScore } from "./affinity.ts";
import type { MonarchTransaction } from "../monarch/types.ts";
import { log } from "../logger.ts";

export type EmailCandidate = {
  entry: EmailIndexEntry;
  score: number;
  amountInBody: boolean;
};

export type TransactionCandidates = {
  transaction: MonarchTransaction;
  candidates: EmailCandidate[];
};

const DATE_WINDOW_DAYS = 7;
const MAX_CANDIDATES_PER_TXN = 5;
// Only pairs with some token affinity go to the LLM; a bare date overlap
// against 34k emails is noise.
const MIN_SCORE = 1;

const JoinRowSchema = z.object({
  txn_id: z.string(),
  email_idx: z.number(),
});

// DuckDB computes the 34k-emails x N-transactions date-window join; token
// scoring and body checks run in TypeScript over the joined shortlist.
async function dateWindowJoin(
  transactions: MonarchTransaction[],
  emails: EmailIndexEntry[],
): Promise<Map<string, number[]>> {
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();

  await connection.run(
    "CREATE TABLE txns (id VARCHAR, date DATE); CREATE TABLE emails (idx INTEGER, date DATE);",
  );
  const txnRows = transactions
    .map((t) => `('${t.id}', DATE '${t.date}')`)
    .join(",");
  const emailRows = emails
    .map((e, i) => (e.date === "" ? null : `(${String(i)}, DATE '${e.date}')`))
    .filter((r) => r !== null)
    .join(",");
  await connection.run(`INSERT INTO txns VALUES ${txnRows}`);
  await connection.run(`INSERT INTO emails VALUES ${emailRows}`);

  const reader = await connection.runAndReadAll(`
    SELECT t.id AS txn_id, e.idx AS email_idx
    FROM txns t
    JOIN emails e
      ON e.date BETWEEN t.date - INTERVAL ${String(DATE_WINDOW_DAYS)} DAY
                    AND t.date + INTERVAL ${String(DATE_WINDOW_DAYS)} DAY
  `);
  const rows = reader.getRowObjects();

  const byTxn = new Map<string, number[]>();
  for (const raw of rows) {
    const row = JoinRowSchema.parse({
      txn_id: String(raw["txn_id"]),
      email_idx: Number(raw["email_idx"]),
    });
    const list = byTxn.get(row.txn_id) ?? [];
    list.push(row.email_idx);
    byTxn.set(row.txn_id, list);
  }
  connection.closeSync();
  return byTxn;
}

async function candidatesForTransaction(
  transaction: MonarchTransaction,
  emailIndexes: number[],
  emails: EmailIndexEntry[],
): Promise<EmailCandidate[]> {
  const scored: EmailCandidate[] = [];
  for (const idx of emailIndexes) {
    const entry = emails[idx];
    if (!entry) continue;
    const score = affinityScore(transaction, entry);
    if (score < MIN_SCORE) continue;
    scored.push({ entry, score, amountInBody: false });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, MAX_CANDIDATES_PER_TXN * 2);

  // Body check boosts candidates whose text contains the exact amount.
  // MailMate rewrites message files as mailboxes sync, so a path from the
  // cached index may no longer exist — those candidates just get no boost.
  const amountText = Math.abs(transaction.amount).toFixed(2);
  for (const candidate of top) {
    const file = Bun.file(candidate.entry.path);
    if (!(await file.exists())) continue;
    const body = extractTextBody(await file.text());
    if (body.includes(amountText)) {
      candidate.amountInBody = true;
      candidate.score += 5;
    }
  }
  top.sort((a, b) => b.score - a.score);
  return top.slice(0, MAX_CANDIDATES_PER_TXN);
}

export async function findCandidates(
  transactions: MonarchTransaction[],
  emails: EmailIndexEntry[],
): Promise<TransactionCandidates[]> {
  const joined = await dateWindowJoin(transactions, emails);
  log.info(
    `Date-window join produced pairs for ${String(joined.size)}/${String(transactions.length)} transactions`,
  );

  const results: TransactionCandidates[] = [];
  for (const transaction of transactions) {
    const final = await candidatesForTransaction(
      transaction,
      joined.get(transaction.id) ?? [],
      emails,
    );
    if (final.length > 0) {
      results.push({ transaction, candidates: final });
    }
  }

  log.info(
    `${String(results.length)}/${String(transactions.length)} transactions have email candidates`,
  );
  log.info(`Candidate scores: ${formatScoreHistogram(results)}`);
  return results;
}

// The shortlist a judgment was made against. Judgments are checkpointed by
// transaction, so without this a "no match" reached from a bad shortlist
// would be pinned forever and an affinity improvement would buy nothing.
export function candidateFingerprint(candidates: EmailCandidate[]): string {
  const paths = candidates.map((c) => c.entry.path).sort();
  return createHash("sha256")
    .update(paths.join("\n"))
    .digest("hex")
    .slice(0, 12);
}

export function formatScoreHistogram(results: TransactionCandidates[]): string {
  const buckets = new Map<string, number>();
  for (const result of results) {
    for (const candidate of result.candidates) {
      const key = candidate.score >= 4 ? "4+" : String(candidate.score);
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([score, count]) => `${score}:${String(count)}`)
    .join(" ");
}
