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
 * Re-settling an already-settled dare additionally needs its stored match. The
 * run refuses before its first write when that match is missing, unreadable, or
 * is not the match the dare settled against:
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
import { settleDaresV2ForMatch } from "#src/betting/dares/settlement/dare-settle-v2.ts";
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

/** The ledger kinds a Dare settlement writes, and therefore the only kinds a
 * reversal has to undo. Contributions (`dare_stake`) predate settlement and
 * stay put. */
const SETTLEMENT_KINDS = ["dare_refund", "dare_fee", "dare_payout"];

const ArgsSchema = z.strictObject({
  apply: z.boolean(),
  matchFile: z.string().nullable(),
});
type Args = z.infer<typeof ArgsSchema>;

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

/** Rewrite one dare's stored contract, and drop the evidence computed under the
 * broken predicate. */
async function repairDare(
  repair: (typeof REPAIRS)[number],
  apply: boolean,
): Promise<void> {
  const dare = await prisma.bucksDareV2.findUnique({
    where: { id: repair.dareId },
    include: { revisions: true, evidence: true },
  });
  if (dare === null) {
    console.log(`dare ${repair.dareId.toString()}: not found, skipping`);
    return;
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
    compiledPlan: repairDocument(revision.compiledPlan, repair.from, repair.to),
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
  // re-evaluated for a match already seen, so it has to go or the repair cannot
  // change the outcome.
  //
  // Only when there was something to repair. Once the contract is corrected, a
  // later run's evidence was computed under the *correct* predicate — dropping
  // it would discard the very rows that justify an achieved dare's settlement.
  const repaired =
    (contract?.replacements ?? 0) > 0 ||
    revisions.some(
      (revision) =>
        revision.compiledPlan.replacements > 0 ||
        revision.canonicalScoutQl.replacements > 0 ||
        revision.plainLanguage.replacements > 0,
    );
  console.log(
    repaired
      ? `  evidence rows to drop: ${dare.evidence.length.toString()} (${dare.evidence.map((row) => row.matchId).join(", ")})`
      : `  nothing to repair; keeping ${dare.evidence.length.toString()} evidence row(s)`,
  );

  if (!apply || !repaired) return;

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

/**
 * The settlement ledger rows belonging to exactly this dare.
 *
 * `dareId` lives inside the row's JSON context, and a SQL `contains
 * '"dareId":6'` also matches `"dareId":60`, `61`, … — reversing those would
 * debit the recipients of an entirely unrelated dare. Postgres cannot express
 * the exact test over that text column without also assuming the JSON's exact
 * spacing, so the candidate rows are parsed and their `dareId` compared
 * numerically here instead.
 */
async function settlementEntriesForDare(dareId: number, since: Date | null) {
  const candidates = await prisma.bucksLedgerEntry.findMany({
    where: {
      kind: { in: SETTLEMENT_KINDS },
      ...(since === null ? {} : { createdAt: { gte: since } }),
    },
    orderBy: { id: "asc" },
  });
  return candidates.filter((entry) => {
    const context = BucksLedgerContextSchema.parse(JSON.parse(entry.context));
    return context.type === "dare" && context.dareId === dareId;
  });
}

type PendingResettlement = {
  dareId: number;
  matchId: string;
  /** The rows this run must reverse. Empty when an earlier run already
   * committed the reversal. */
  entries: Awaited<ReturnType<typeof settlementEntriesForDare>>;
  /** False only when the dare is genuinely untouched: never settled, nothing
   * reversed, nothing owed. */
  needsResettle: boolean;
  reversalAlreadyCommitted: boolean;
};

/**
 * Decide what a dare still owes, without writing anything.
 *
 * `settledAt === null` is not by itself evidence that there is nothing to do.
 * The reversal resets `settledAt` in the same transaction that debits the
 * accounts, so a run that reversed and then failed to re-settle leaves exactly
 * that shape — with real balances short. Treating it as "nothing to reverse"
 * would strand them permanently, so the settlement rows are what is consulted:
 * if they exist while the dare is unsettled, the reversal has committed and
 * only the re-settlement is outstanding.
 */
async function planResettlement(
  dareId: number,
  matchId: string,
): Promise<PendingResettlement> {
  const dare = await prisma.bucksDareV2.findUnique({ where: { id: dareId } });
  if (dare === null) {
    return {
      dareId,
      matchId,
      entries: [],
      needsResettle: false,
      reversalAlreadyCommitted: false,
    };
  }
  if (dare.settledAt !== null) {
    // Decide from the evidence, not from the contract text.
    //
    // A settled dare that has already been repaired and re-settled must not be
    // touched again: reversing a *correct* settlement debits the winner, which
    // throws once that balance has been spent down and leaves the ledger
    // half-reversed. But "the contract no longer says MID" is not proof the
    // re-settlement finished — the rewrite and the reversal are separate
    // commits, so a run that rewrote the contract and then failed to reverse
    // leaves exactly that state, and treating it as complete would strand the
    // stale settlement forever.
    //
    // The repair transaction deletes this dare's evidence, and only
    // re-settlement writes it back. So a settled dare holding evidence was
    // settled against evidence that survived the repair; a settled dare holding
    // none was interrupted between the two commits and still needs recovery.
    const evidenceCount = await prisma.bucksDareV2Evidence.count({
      where: { dareId },
    });
    const repair = REPAIRS.find((candidate) => candidate.dareId === dareId);
    const contractRepaired =
      repair !== undefined &&
      dare.contractJson !== null &&
      repairDocument(dare.contractJson, repair.from, repair.to).replacements ===
        0;
    if (contractRepaired && evidenceCount > 0) {
      return {
        dareId,
        matchId,
        entries: [],
        needsResettle: false,
        reversalAlreadyCommitted: false,
      };
    }
    return {
      dareId,
      matchId,
      entries: await settlementEntriesForDare(dareId, dare.settledAt),
      needsResettle: true,
      reversalAlreadyCommitted: false,
    };
  }
  const reversed = await settlementEntriesForDare(dareId, null);
  return {
    dareId,
    matchId,
    entries: [],
    needsResettle: reversed.length > 0,
    reversalAlreadyCommitted: reversed.length > 0,
  };
}

/**
 * Load the match this run will re-settle against, refusing the run outright if
 * it cannot finish.
 *
 * Every reason the re-settlement cannot happen is checked here, ahead of the
 * first write. The contract rewrites and the evidence deletion are what make a
 * re-settlement necessary; committing them and only then discovering that no
 * usable match was supplied would leave a settled dare judged against an
 * evaluation that no longer exists.
 */
async function loadMatchForRun(
  args: Args,
  pending: readonly PendingResettlement[],
) {
  const outstanding = pending.filter((target) => target.needsResettle);
  const required = new Set(outstanding.map((target) => target.matchId));
  if (required.size > 1) {
    throw new Error(
      `Re-settlement needs ${required.size.toString()} different matches (${[...required].join(", ")}), and only one --match-file can be supplied. Repair these dares one run at a time.`,
    );
  }
  if (args.matchFile === null) {
    if (args.apply && required.size > 0) {
      const ids = outstanding
        .map((target) => target.dareId.toString())
        .join(", ");
      throw new Error(
        `Dare(s) ${ids} must be re-settled against ${[...required].join(", ")}; pass --match-file with that match before --apply.`,
      );
    }
    return null;
  }
  const matchData = RawMatchSchema.parse(await Bun.file(args.matchFile).json());
  const suppliedMatchId = matchData.metadata.matchId;
  if (required.size > 0 && !required.has(suppliedMatchId)) {
    throw new Error(
      `--match-file holds ${suppliedMatchId}, but re-settlement needs ${[...required].join(", ")}. Settling against another match would reverse the ledger and leave the dare unsettled.`,
    );
  }
  return matchData;
}

/** Write the opposite of every settlement row and return the dare to `active`,
 * atomically, so a failure cannot leave the ledger reversed while the dare
 * still claims to be settled. */
async function reverseSettlement(target: PendingResettlement): Promise<void> {
  await prisma.$transaction(async (tx) => {
    for (const entry of target.entries) {
      await applyBucksDelta(tx, {
        bucksAccountId: entry.bucksAccountId,
        delta: -entry.delta,
        kind: BucksLedgerKindSchema.parse(entry.kind),
        // A reversal belongs to the same match as the row it undoes; omitting
        // this stores the corrective row with a null match, which no longer
        // joins to the settlement it is correcting.
        matchId: entry.matchId ?? undefined,
        // Reuse the original entry's context verbatim so the reversal is
        // traceable to exactly the movement it undoes.
        context: BucksLedgerContextSchema.parse(JSON.parse(entry.context)),
      });
    }
    await tx.bucksDareV2.update({
      where: { id: target.dareId },
      data: {
        dareState: "active",
        settledAt: null,
        finalValue: null,
        proofJson: null,
        voidReason: null,
      },
    });
  });
}

/**
 * Re-settle through the production path so the evidence is recomputed by the
 * real evaluator and the payout uses the real arithmetic, including its
 * conservation assertions. Reproducing that math here would be a second
 * implementation to keep in step.
 *
 * The result is verified rather than assumed: at this point the settlement is
 * already reversed, so a match that does not select this dare — the wrong game,
 * a contract that still fails to compile, a deadline outside the game window —
 * leaves real balances short. That has to be an error an operator cannot miss.
 */
async function resettleDare(
  target: PendingResettlement,
  matchData: z.infer<typeof RawMatchSchema>,
): Promise<void> {
  const summaries = await settleDaresV2ForMatch(matchData, prisma);
  console.log(
    `  re-settled ${summaries.length.toString()} dare(s) through the production path`,
  );
  const after = await prisma.bucksDareV2.findUnique({
    where: { id: target.dareId },
  });
  if (after === null || after.settledAt === null) {
    throw new Error(
      `dare ${target.dareId.toString()} is still unsettled after re-settling ${target.matchId} (state: ${after?.dareState ?? "missing"}). Its settlement ledger is already reversed, so balances stay short until this completes. Fix the cause and re-run with the same --match-file: the re-run detects the committed reversal and resumes at re-settlement.`,
    );
  }
  console.log(`  dare ${target.dareId.toString()} is now: ${after.dareState}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.apply ? "APPLY" : "DRY RUN";
  console.log(`Dare contract repair — ${mode}\n`);

  // Read the entire plan, and the match it depends on, before the first write.
  const pending: PendingResettlement[] = [];
  for (const [dareId, matchId] of RESETTLE) {
    pending.push(await planResettlement(dareId, matchId));
  }
  const matchData = await loadMatchForRun(args, pending);

  for (const repair of REPAIRS) {
    await repairDare(repair, args.apply);
  }

  for (const target of pending) {
    console.log(
      `\nRe-settlement for dare ${target.dareId.toString()} (${target.matchId}):`,
    );
    if (!target.needsResettle) {
      console.log("  already repaired and settled; nothing to do");
      continue;
    }
    if (target.reversalAlreadyCommitted) {
      console.log(
        "  settlement ledger was already reversed by an earlier run; only re-settlement is outstanding",
      );
    }
    for (const entry of target.entries) {
      console.log(
        `  reverse ledger ${entry.id.toString()}: account ${entry.bucksAccountId.toString()} ${entry.delta > 0 ? "+" : ""}${entry.delta.toString()} (${entry.kind}) -> ${(-entry.delta).toString()}`,
      );
    }
    console.log(
      `  reset to active, then re-settle through settleDaresV2ForMatch`,
    );

    if (!args.apply) continue;
    if (matchData === null) {
      throw new Error(
        `no match loaded for dare ${target.dareId.toString()}; the preflight admitted a run it should have refused`,
      );
    }
    if (target.entries.length > 0) {
      await reverseSettlement(target);
      console.log("  reversed and reset");
    }
    await resettleDare(target, matchData);
  }

  await prisma.$disconnect();
}

await main();
