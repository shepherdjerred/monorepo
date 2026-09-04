/**
 * One-off repair for Dare contracts written with values Riot never emits.
 *
 * Three beta dares were authored with `team_position` spellings that cannot
 * match any game — `MID` where Riot records `MIDDLE`, `SUPPORT` where it records
 * `UTILITY`. The contracts are otherwise exactly what their participants agreed
 * to: the plain language said "MID" and every human read that as mid lane. So
 * this repairs the stored value rather than voiding the dares, which preserves
 * the agreed terms instead of discarding them.
 *
 * Deliberately a script and not a migration. It names its targets explicitly,
 * defaults to a dry run, and prints every write it would make.
 *
 *   bun run scripts/repair-dare-domain-contracts.ts                  # dry run
 *   bun run scripts/repair-dare-domain-contracts.ts --apply
 *
 * Re-settling an already-settled dare additionally needs its stored match:
 *
 *   bun run scripts/repair-dare-domain-contracts.ts --apply \
 *     --match-file ./NA1_5634887146.match.json
 */
import { z } from "zod";
import {
  BucksLedgerContextSchema,
  BucksLedgerKindSchema,
  RawMatchSchema,
} from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { settleDaresV2ForMatch } from "#src/betting/dare-settle-v2.ts";
import { applyBucksDelta } from "#src/betting/ledger.ts";

/**
 * The exact substitutions to make, per dare. Written out rather than inferred:
 * a script that moves real balances should say precisely what it changes, and a
 * reviewer should be able to check each one against the match data.
 */
const REPAIRS = [
  { dareId: 4, from: "SUPPORT", to: "UTILITY" },
  { dareId: 5, from: "SUPPORT", to: "UTILITY" },
  { dareId: 6, from: "MID", to: "MIDDLE" },
] as const;

/** Dares that already settled and must be re-evaluated against the repair. */
const RESETTLE = new Map<number, string>([[6, "NA1_5634887146"]]);

const ArgsSchema = z.strictObject({
  apply: z.boolean(),
  matchFile: z.string().nullable(),
});

function parseArgs(argv: readonly string[]) {
  const apply = argv.includes("--apply");
  const index = argv.indexOf("--match-file");
  const matchFile = index === -1 ? null : (argv[index + 1] ?? null);
  const unknown = argv.filter(
    (arg, position) =>
      arg.startsWith("--") &&
      arg !== "--apply" &&
      arg !== "--match-file" &&
      argv[position - 1] !== "--match-file",
  );
  if (unknown.length > 0) {
    throw new Error(`Unknown flag(s): ${unknown.join(", ")}`);
  }
  return ArgsSchema.parse({ apply, matchFile });
}

/**
 * Replace the value everywhere the contract states it.
 *
 * A contract carries the same threshold three times — in the compiled plan, in
 * the canonical ScoutQL text, and in the plain-language rendering. Repairing one
 * and not the others would leave the dare describing itself inconsistently, so
 * this rewrites the whole document and reports the count per delimiter.
 *
 * Counting is done per pattern rather than by differencing occurrences before
 * and after, because a replacement may *contain* the original — MIDDLE contains
 * MID — which makes a difference-based count read zero for a change that did
 * happen.
 */
function repairDocument(
  raw: string,
  from: string,
  to: string,
): { text: string; replacements: number } {
  // Whole-token replacement via word boundaries. A bare substring replace would
  // corrupt any word containing the value, while a hand-written delimiter list
  // misses real punctuation — the plain-language rendering ends the value with
  // `)`, as in "team position equals MID)", which an explicit list overlooked.
  //
  // Word boundaries also make the MIDDLE-contains-MID case safe in both
  // directions: \bMID\b cannot match inside MIDDLE, so re-running this script
  // is a no-op rather than producing MIDDLEDLE.
  const pattern = new RegExp(`\\b${from}\\b`, "gu");
  const replacements = (raw.match(pattern) ?? []).length;
  return { text: raw.replaceAll(pattern, to), replacements };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.apply ? "APPLY" : "DRY RUN";
  console.log(`Dare contract repair — ${mode}\n`);

  for (const repair of REPAIRS) {
    const dare = await prisma.bucksDareV2.findUnique({
      where: { id: repair.dareId },
      include: { revisions: true, evidence: true },
    });
    if (dare === null) {
      console.log(`dare ${repair.dareId.toString()}: not found, skipping`);
      continue;
    }

    console.log(
      `dare ${repair.dareId.toString()} (${dare.dareState}): ${repair.from} -> ${repair.to}`,
    );

    const contract =
      dare.contractJson === null
        ? null
        : repairDocument(dare.contractJson, repair.from, repair.to);
    if (contract !== null) {
      console.log(
        `  contractJson: ${contract.replacements.toString()} occurrence(s)`,
      );
    }

    const revisions = dare.revisions.map((revision) => ({
      revision: revision.revision,
      compiledPlan: repairDocument(
        revision.compiledPlan,
        repair.from,
        repair.to,
      ),
      canonicalScoutQl: repairDocument(
        revision.canonicalScoutQl,
        repair.from,
        repair.to,
      ),
      plainLanguage: repairDocument(
        revision.plainLanguage,
        repair.from,
        repair.to,
      ),
    }));
    for (const revision of revisions) {
      console.log(
        `  revision ${revision.revision.toString()}: plan=${revision.compiledPlan.replacements.toString()} sql=${revision.canonicalScoutQl.replacements.toString()} text=${revision.plainLanguage.replacements.toString()}`,
      );
    }

    // Captured evidence was computed against the broken predicate and is never
    // re-evaluated for a match already seen, so it has to go or the repair
    // cannot change the outcome.
    console.log(
      `  evidence rows to drop: ${dare.evidence.length.toString()} (${dare.evidence.map((row) => row.matchId).join(", ")})`,
    );

    if (!args.apply) continue;

    await prisma.$transaction(async (tx) => {
      if (contract !== null) {
        await tx.bucksDareV2.update({
          where: { id: repair.dareId },
          data: { contractJson: contract.text },
        });
      }
      for (const revision of revisions) {
        await tx.bucksDareV2Revision.update({
          where: {
            dareId_revision: {
              dareId: repair.dareId,
              revision: revision.revision,
            },
          },
          data: {
            compiledPlan: revision.compiledPlan.text,
            canonicalScoutQl: revision.canonicalScoutQl.text,
            plainLanguage: revision.plainLanguage.text,
          },
        });
      }
      await tx.bucksDareV2Evidence.deleteMany({
        where: { dareId: repair.dareId },
      });
    });
    console.log(`  applied`);
  }

  for (const [dareId, matchId] of RESETTLE) {
    console.log(`\nRe-settlement for dare ${dareId.toString()} (${matchId}):`);
    const dare = await prisma.bucksDareV2.findUnique({ where: { id: dareId } });
    if (dare === null || dare.settledAt === null) {
      console.log("  not settled; nothing to reverse");
      continue;
    }

    // Everything this dare's settlement moved. Reversing means writing the
    // opposite of each entry rather than deleting them: the ledger is the audit
    // trail, and a settlement that should not have happened is part of the
    // history, not something to erase.
    const settlementEntries = await prisma.bucksLedgerEntry.findMany({
      where: {
        kind: { in: ["dare_refund", "dare_fee", "dare_payout"] },
        context: { contains: `"dareId":${dareId.toString()}` },
        createdAt: { gte: dare.settledAt },
      },
      orderBy: { id: "asc" },
    });
    for (const entry of settlementEntries) {
      console.log(
        `  reverse ledger ${entry.id.toString()}: account ${entry.bucksAccountId.toString()} ${entry.delta > 0 ? "+" : ""}${entry.delta.toString()} (${entry.kind}) -> ${(-entry.delta).toString()}`,
      );
    }
    console.log(
      `  reset to active, then re-settle through settleDaresV2ForMatch`,
    );

    if (!args.apply) continue;
    if (args.matchFile === null) {
      console.log("  --match-file is required to re-settle; skipped");
      continue;
    }
    const matchData = RawMatchSchema.parse(
      await Bun.file(args.matchFile).json(),
    );

    await prisma.$transaction(async (tx) => {
      for (const entry of settlementEntries) {
        await applyBucksDelta(tx, {
          bucksAccountId: entry.bucksAccountId,
          delta: -entry.delta,
          kind: BucksLedgerKindSchema.parse(entry.kind),
          // Reuse the original entry's context verbatim so the reversal is
          // traceable to exactly the movement it undoes.
          context: BucksLedgerContextSchema.parse(JSON.parse(entry.context)),
        });
      }
      await tx.bucksDareV2.update({
        where: { id: dareId },
        data: {
          dareState: "active",
          settledAt: null,
          finalValue: null,
          proofJson: null,
          voidReason: null,
        },
      });
    });
    console.log("  reversed and reset");

    // Re-settle through the production path so the evidence is recomputed by
    // the real evaluator and the payout uses the real arithmetic, including its
    // conservation assertions. Reproducing that math here would be a second
    // implementation to keep in step.
    const summaries = await settleDaresV2ForMatch(matchData, prisma);
    console.log(
      `  re-settled ${summaries.length.toString()} dare(s) through the production path`,
    );
    const after = await prisma.bucksDareV2.findUnique({
      where: { id: dareId },
    });
    console.log(
      `  dare ${dareId.toString()} is now: ${after?.dareState ?? "?"}`,
    );
  }

  await prisma.$disconnect();
}

await main();
