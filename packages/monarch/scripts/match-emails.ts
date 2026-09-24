// Match MailMate emails to Monarch transactions: find the email documenting
// each purchase, have the LLM suggest a note and (optionally) a better
// category, and apply through the guard/notes machinery.
//
//   OPENAI_API_KEY=... bun run scripts/match-emails.ts \
//     [--apply] [--limit N] [--rebuild-index] [--model <id>]
//
// Dry run by default: prints the match report and writes nothing.
import { parseArgs } from "node:util";
import path from "node:path";
import { homedir } from "node:os";
import {
  initMonarch,
  fetchAllTransactions,
  fetchCategories,
  setTransactionNotes,
} from "../src/lib/monarch/client.ts";
import { requireCredentialsFor } from "@shepherdjerred/llm-runtime";
import { initLlm } from "../src/lib/classifier/llm.ts";
import { loadEmailIndex } from "../src/lib/mail/index.ts";
import {
  findCandidates,
  candidateFingerprint,
  formatScoreHistogram,
} from "../src/lib/mail/candidates.ts";
import {
  judgeEmailMatch,
  transactionFingerprint,
  EmailMatchSchema,
  EMAIL_NOTE_PREFIX,
  type EmailMatchResult,
} from "../src/lib/mail/match.ts";
import { guardCrossGroupChanges } from "../src/lib/verification/transfer-guard.ts";
import { applyChanges } from "../src/lib/apply.ts";
import type { ProposedChange } from "../src/lib/classifier/types.ts";
import type { TransactionCandidates } from "../src/lib/mail/candidates.ts";
import {
  EMAIL_MATCH_CHECKPOINT_PATH,
  LEGACY_EMAIL_MATCH_CHECKPOINT_PATH,
  resolveCachePath,
} from "../src/lib/finance-vault.ts";
import { log } from "../src/lib/logger.ts";
import { z } from "zod";

const { values } = parseArgs({
  options: {
    apply: { type: "boolean", default: false },
    limit: { type: "string", default: "0" },
    "rebuild-index": { type: "boolean", default: false },
    model: { type: "string", default: "gpt-5.6-luna" },
    concurrency: { type: "string", default: "3" },
    "candidates-only": { type: "boolean", default: false },
    // A note is additive: it documents a transaction and displaces nothing.
    // A recategorization overwrites a decision that may have been made
    // deliberately, so the two are separately appliable.
    "notes-only": { type: "boolean", default: false },
  },
  strict: true,
});
const LIMIT = Number(values.limit);
const CONCURRENCY = Math.max(1, Number(values.concurrency));

requireCredentialsFor(values.model);
initLlm(values.model);

const CHECKPOINT_PATH = await resolveCachePath(
  EMAIL_MATCH_CHECKPOINT_PATH,
  LEGACY_EMAIL_MATCH_CHECKPOINT_PATH,
);
const CheckpointSchema = z.record(z.string(), EmailMatchSchema);

// A key is `<txn>:<model>:<shortlist fingerprint>`. Entries written before the
// fingerprint existed are dropped rather than reused: a verdict reached
// against a different shortlist is exactly what the fingerprint exists to
// re-open, and replaying one pinned 238 transactions to a match that said
// nothing. They are cheap to re-earn and expensive to trust.
function isFingerprinted(key: string): boolean {
  return key.split(":").length >= 3;
}

async function loadCheckpoint(): Promise<Record<string, EmailMatchResult>> {
  if (!(await Bun.file(CHECKPOINT_PATH).exists())) return {};
  const raw: unknown = JSON.parse(await Bun.file(CHECKPOINT_PATH).text());
  const parsed = CheckpointSchema.parse(raw);
  const kept = Object.fromEntries(
    Object.entries(parsed).filter(([key]) => isFingerprinted(key)),
  );
  const dropped = Object.keys(parsed).length - Object.keys(kept).length;
  if (dropped > 0) {
    log.info(
      `Dropped ${String(dropped)} checkpoint entries predating the shortlist fingerprint`,
    );
  }
  return kept;
}

await initMonarch();
const categories = await fetchCategories();
const groupTypeById = new Map(categories.map((c) => [c.id, c.group.type]));
const today = new Date().toISOString().split("T")[0] ?? "";
const allTxns = await fetchAllTransactions("2021-01-01", today, false);

// Transfers and credit-card payments have no purchase emails; already-split
// transactions are already itemized.
const eligible = allTxns.filter(
  (t) =>
    !t.isSplitTransaction &&
    !t.pending &&
    groupTypeById.get(t.category.id) !== "transfer",
);
log.info(
  `${String(eligible.length)}/${String(allTxns.length)} transactions eligible for email matching`,
);

const emails = await loadEmailIndex(values["rebuild-index"]);
let withCandidates = await findCandidates(eligible, emails);
if (LIMIT > 0) withCandidates = withCandidates.slice(0, LIMIT);

// Measuring a shortlist change costs nothing; judging it costs money. This
// exits before the first model call so an affinity change can be compared
// against the previous build for free.
if (values["candidates-only"]) {
  console.log("\n=== Candidate Report (no judging) ===");
  console.log(
    `  Transactions with candidates: ${String(withCandidates.length)}/${String(eligible.length)}`,
  );
  console.log(
    `  Candidate scores:             ${formatScoreHistogram(withCandidates)}`,
  );
  process.exit(0);
}

// A judgment is only reusable while everything it was made against is
// unchanged: the shortlist of candidate emails, and the transaction facts the
// prompt states. Both are fingerprinted into the key, so an edited category or
// a re-merchanted row is re-judged rather than replayed.
function checkpointKey(item: TransactionCandidates): string {
  return [
    item.transaction.id,
    values.model,
    candidateFingerprint(item.candidates),
    transactionFingerprint(item),
  ].join(":");
}

// LLM judgment with checkpoint resume
const checkpoint = await loadCheckpoint();
const results = new Map<string, EmailMatchResult>();
const pending: TransactionCandidates[] = [];
for (const item of withCandidates) {
  const cached = checkpoint[checkpointKey(item)];
  if (cached !== undefined) {
    results.set(item.transaction.id, cached);
    continue;
  }
  pending.push(item);
}
log.info(
  `Judging ${String(pending.length)} transactions (${String(results.size)} from checkpoint)...`,
);

async function judgeWithRetry(
  item: TransactionCandidates,
): Promise<EmailMatchResult> {
  try {
    return await judgeEmailMatch(item, categories);
  } catch {
    // Transient transport hiccups ("failed to process successful response")
    // can hit a whole concurrency chunk at once; one retry clears them.
    return judgeEmailMatch(item, categories);
  }
}

let done = 0;
const failedTransactionIds: string[] = [];
for (let i = 0; i < pending.length; i += CONCURRENCY) {
  const chunk = pending.slice(i, i + CONCURRENCY);
  const settled = await Promise.allSettled(
    chunk.map(async (item) => ({
      id: item.transaction.id,
      key: checkpointKey(item),
      result: await judgeWithRetry(item),
    })),
  );
  for (const [j, outcome] of settled.entries()) {
    if (outcome.status === "fulfilled") {
      results.set(outcome.value.id, outcome.value.result);
      checkpoint[outcome.value.key] = outcome.value.result;
    } else {
      const id = chunk[j]?.transaction.id ?? "unknown";
      failedTransactionIds.push(id);
      log.warn(`Judgment failed for txn ${id}: ${String(outcome.reason)}`);
    }
  }
  await Bun.write(EMAIL_MATCH_CHECKPOINT_PATH, JSON.stringify(checkpoint));
  done += chunk.length;
  if (done % 30 === 0 || done === pending.length) {
    log.progress(done, pending.length, "transactions judged");
  }
}
if (failedTransactionIds.length > 0) {
  log.warn(
    `${String(failedTransactionIds.length)} transactions failed judgment after retry; rerun to retry them`,
  );
}

// Assemble outcomes
const byId = new Map(withCandidates.map((c) => [c.transaction.id, c]));
type Outcome = {
  item: TransactionCandidates;
  result: EmailMatchResult;
};
const matched: Outcome[] = [];
let malformedIndexes = 0;
for (const [id, result] of results) {
  const item = byId.get(id);
  if (!item) continue;
  if (result.matchedIndex === null || result.confidence === "low") continue;
  // The schema accepts any number. An index that does not name one of this
  // transaction's own candidates refers to an email that was never read, so
  // the note and category that came with it describe nothing — reject rather
  // than write them.
  const index = result.matchedIndex;
  if (
    index < 0 ||
    index >= item.candidates.length ||
    !Number.isInteger(index)
  ) {
    malformedIndexes++;
    continue;
  }
  matched.push({ item, result });
}
if (malformedIndexes > 0) {
  log.warn(
    `${String(malformedIndexes)} judgments named a candidate index outside their own shortlist and were discarded`,
  );
}

const noteWrites = matched.filter((m) => {
  if (m.result.note === null || m.result.note === "") return false;
  const existing = m.item.transaction.notes;
  const note = `${EMAIL_NOTE_PREFIX}${m.result.note}`;
  return (
    (existing === "" || existing.startsWith(EMAIL_NOTE_PREFIX)) &&
    existing !== note
  );
});

// A note and a recategorization need different amounts of evidence. A
// same-day receipt from the same merchant is worth documenting even when the
// email does not state a total; it is not enough to overwrite a category.
// Measured over 332 proposed changes, all 30 whose own stated reason admitted
// the email showed no amount, or that the dates disagreed, were medium or low
// confidence — none were high. Among them: eight sub-dollar `Deposit` rows
// that are plainly posted interest, matched to amount-less "mobile check
// deposit" mail, and a $0.07 row that would have left `Interest` for
// `Other Income`.
const categoryChanges: ProposedChange[] = [];
let weaklyEvidenced = 0;
for (const m of matched) {
  const suggested = m.result.suggestedCategoryId;
  if (suggested === null || suggested === m.item.transaction.category.id) {
    continue;
  }
  if (m.result.confidence !== "high") {
    weaklyEvidenced++;
    continue;
  }
  const target = categories.find((c) => c.id === suggested);
  if (!target) continue;
  const t = m.item.transaction;
  categoryChanges.push({
    transactionId: t.id,
    transactionDate: t.date,
    merchantName: t.merchant.name,
    amount: t.amount,
    currentCategory: t.category.name,
    currentCategoryId: t.category.id,
    proposedCategory: target.name,
    proposedCategoryId: target.id,
    confidence: m.result.confidence,
    type: "recategorize",
    reason: m.result.reason,
    enrichmentSource: "email",
  });
}
const { changes: guardedChanges, demoted } = guardCrossGroupChanges(
  categoryChanges,
  categories,
);
if (weaklyEvidenced > 0) {
  log.info(
    `${String(weaklyEvidenced)} category changes withheld: the match is real enough to note but not to recategorize`,
  );
}

console.log("\n=== Email Match Report ===");
console.log(`  Transactions with candidates: ${String(withCandidates.length)}`);
console.log(`  Confident email matches:      ${String(matched.length)}`);
console.log(`  Notes to write:               ${String(noteWrites.length)}`);
console.log(
  `  Category changes:             ${String(guardedChanges.length)} (${String(demoted)} demoted to review flags)`,
);
console.log("\n  Sample notes:");
for (const m of noteWrites.slice(0, 10)) {
  console.log(
    `    ${m.item.transaction.date} ${m.item.transaction.merchant.name}: ${(m.result.note ?? "").slice(0, 90)}`,
  );
}
// Every category change is listed, not a sample. A note is additive and
// reversible by eye; a recategorization overwrites a decision that may have
// been made deliberately, so all of them are worth reading before --apply.
console.log("\n  Category changes:");
for (const c of guardedChanges) {
  console.log(
    `    ${c.transactionDate} $${String(c.amount)} ${c.merchantName}: ${c.currentCategory} -> ${c.proposedCategory} [${c.type}]`,
  );
}

if (!values.apply) {
  console.log("\nDry run. Pass --apply to write notes and category changes.");
  console.log("Pass --apply --notes-only to write only the notes.");
  process.exit(0);
}

log.info(`Writing ${String(noteWrites.length)} notes...`);
let notesWritten = 0;
for (const m of noteWrites) {
  await setTransactionNotes(
    m.item.transaction.id,
    `${EMAIL_NOTE_PREFIX}${m.result.note ?? ""}`,
  );
  notesWritten++;
  if (notesWritten % 25 === 0) {
    log.progress(notesWritten, noteWrites.length, "notes written");
  }
}
if (values["notes-only"]) {
  console.log(
    `Done. ${String(notesWritten)} notes written; ${String(guardedChanges.length)} category changes held back (--notes-only).`,
  );
  process.exit(0);
}

await applyChanges(guardedChanges, false);
console.log(
  `Done. ${String(notesWritten)} notes written, ${String(guardedChanges.length)} category changes/flags applied.`,
);
