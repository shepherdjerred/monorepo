/**
 * Retire Dare v1 and the v2 dialect: drain every open pre-v3 dare through the
 * EXISTING per-version money paths, prove nothing open remains, then delete
 * the stored pre-v3 records so the follow-up code deletion cannot orphan them.
 *
 * Deliberately a script and not a migration (the repair-script precedent): it
 * defaults to a dry run, prints every write it would make, and each phase is
 * explicit. Run order against the beta database:
 *
 *   bun run scripts/retire/retire-dare-v1-v2.ts                    # report
 *   bun run scripts/retire/retire-dare-v1-v2.ts --void --apply     # drain
 *   bun run scripts/retire/retire-dare-v1-v2.ts --verify           # prove
 *   bun run scripts/retire/retire-dare-v1-v2.ts --purge --apply --writes-quiesced
 *
 * Money movement always goes through the shipped refund paths while they
 * still exist — v1 sweep/void helpers and the v2 cancel/void transactions —
 * never through hand-rolled ledger writes. Purge refuses to run unless the
 * verify predicate passes in the same invocation, and reports the dare-bound
 * ConfirmationIntent count so the cascade provably left the report and
 * subscription intents alone.
 *
 * QUIESCENCE INTERLOCK: purge additionally requires --writes-quiesced, the
 * operator's assertion that no pre-v3 dare can be authored or funded while
 * the purge runs or afterwards — concretely, both `dare_v2` and
 * `bucks_dares_enabled` are disabled in Flipt for every guild (`/bb dare`
 * otherwise falls back to the v1 writer), and they STAY disabled until the
 * retirement PRs that delete the v2 and v1 write paths have deployed. The
 * claim-conditioned deletes and the post-delete pre-v3 scans catch a violation
 * mid-run, but only the durable flag flips prevent a pre-v3 dare from being
 * authored after the run declares success.
 */
import { z } from "zod";
import { prisma, type ExtendedPrismaClient } from "#src/database/index.ts";
import {
  abandonExpiredDareProposals,
  expireDareAcceptWindows,
} from "#src/betting/dares/settlement/dare-sweep.ts";
import {
  dareRefundView,
  voidDareWithFullRefund,
} from "#src/betting/dares/settlement/dare-settle-shared.ts";
import { cancelDareV2InTransaction } from "#src/betting/dares/settlement/dare-refund-v2.ts";
import { voidDareV2WithFullRefund } from "#src/betting/dares/settlement/dare-void-v2.ts";
import {
  BucksDareStateSchema,
  BucksDareV2StateSchema,
  DiscordAccountIdSchema,
} from "@scout-for-lol/data";

const DARE_SQL_V3_COMPILER = "dare-scoutql-3";

/** Far enough in the future that every proposal/accept deadline has lapsed. */
const DRAIN_HORIZON = new Date("2100-01-01T00:00:00Z");

const OPEN_V1_STATES = ["proposed", "pending_accept", "active"] as const;
const OPEN_V2_STATES = ["pending_accept", "activating", "active"] as const;

const OPEN_V1_STATE_SET = new Set<string>(OPEN_V1_STATES);
const OPEN_V2_STATE_SET = new Set<string>(OPEN_V2_STATES);

const TERMINAL_V1_STATES = BucksDareStateSchema.options.filter(
  (state) => !OPEN_V1_STATE_SET.has(state),
);
const TERMINAL_V2_STATES = BucksDareV2StateSchema.options.filter(
  (state) => state !== "draft" && !OPEN_V2_STATE_SET.has(state),
);

/**
 * A misspelled, corrupt, or newly introduced state must stop the run before
 * openness is judged: an unknown state would otherwise read as "terminal" and
 * purge could cascade-delete a pot it never refunded.
 */
async function assertKnownDareStates(db: ExtendedPrismaClient): Promise<void> {
  const v1States = await db.bucksDare.findMany({
    select: { id: true, dareState: true },
  });
  for (const row of v1States) {
    const parsed = BucksDareStateSchema.safeParse(row.dareState);
    if (!parsed.success) {
      throw new Error(
        `v1 dare ${row.id.toString()} has unrecognized state "${row.dareState}"`,
      );
    }
  }
  const v2States = await db.bucksDareV2.findMany({
    select: { id: true, dareState: true },
  });
  for (const row of v2States) {
    const parsed = BucksDareV2StateSchema.safeParse(row.dareState);
    if (!parsed.success) {
      throw new Error(
        `v2 dare ${row.id.toString()} has unrecognized state "${row.dareState}"`,
      );
    }
  }
}

/**
 * Every stored revision — governing or historical, on retired and retained
 * dares alike — must carry a recognized compiler version before any phase
 * proceeds, so no cascade can silently erase a revision this run never
 * classified.
 */
async function assertKnownCompilerVersions(
  db: ExtendedPrismaClient,
): Promise<void> {
  const revisions = await db.bucksDareV2Revision.findMany({
    select: { dareId: true, revision: true, compilerVersion: true },
  });
  for (const row of revisions) {
    if (
      row.compilerVersion !== DARE_SQL_V3_COMPILER &&
      !PRE_V3_COMPILERS.has(row.compilerVersion)
    ) {
      throw new Error(
        `Dare ${row.dareId.toString()} revision ${row.revision.toString()} has unrecognized compiler version "${row.compilerVersion}"`,
      );
    }
  }
}

const ArgsSchema = z.strictObject({
  apply: z.boolean(),
  writesQuiesced: z.boolean(),
  phase: z.enum(["report", "void", "verify", "purge"]),
});

function parseArgs(argv: readonly string[]) {
  const known = new Set([
    "--apply",
    "--void",
    "--verify",
    "--purge",
    "--writes-quiesced",
  ]);
  const unknown = argv.filter(
    (argument) => argument.startsWith("--") && !known.has(argument),
  );
  if (unknown.length > 0) {
    throw new Error(`Unknown flag(s): ${unknown.join(", ")}`);
  }
  const phases = ["--void", "--verify", "--purge"].filter((flag) =>
    argv.includes(flag),
  );
  if (phases.length > 1) {
    throw new Error(`Choose one phase, not ${phases.join(" + ")}`);
  }
  return ArgsSchema.parse({
    apply: argv.includes("--apply"),
    writesQuiesced: argv.includes("--writes-quiesced"),
    phase: phases[0]?.slice(2) ?? "report",
  });
}

type DareV2WithRevisions = Awaited<ReturnType<typeof loadDareV2Rows>>[number];

async function loadDareV2Rows(db: ExtendedPrismaClient) {
  return await db.bucksDareV2.findMany({
    include: {
      targets: true,
      contributions: { select: { id: true } },
      revisions: {
        select: { id: true, revision: true, compilerVersion: true },
      },
    },
    orderBy: { id: "asc" },
  });
}

/** The revision that governs a dare's stored semantics. */
function effectiveCompilerVersion(dare: DareV2WithRevisions): string {
  const effective = dare.fundedRevision ?? dare.currentRevision;
  const revision = dare.revisions.find(
    (candidate) => candidate.revision === effective,
  );
  if (revision === undefined) {
    throw new Error(
      `Dare ${dare.id.toString()} has no revision row ${effective.toString()}`,
    );
  }
  return revision.compilerVersion;
}

/** Every dialect this retirement recognizes as retirable. */
const PRE_V3_COMPILERS = new Set(["dare-scoutql-1", "dare-scoutql-2"]);

/**
 * Closed classification: v3 is retained, the two known pre-v3 dialects are
 * retired, and any other stored value fails loudly — an unrecognized
 * compiler version is corrupt data, never something to silently refund and
 * delete.
 */
function isPreV3(dare: DareV2WithRevisions): boolean {
  const compiler = effectiveCompilerVersion(dare);
  if (compiler === DARE_SQL_V3_COMPILER) return false;
  if (PRE_V3_COMPILERS.has(compiler)) return true;
  throw new Error(
    `Dare ${dare.id.toString()} has unrecognized compiler version "${compiler}"`,
  );
}

async function report(db: ExtendedPrismaClient = prisma): Promise<void> {
  const [v1ByState, v2Rows, v1Targets, v1Contributions, v1Games] =
    await Promise.all([
      db.bucksDare.groupBy({ by: ["dareState"], _count: { _all: true } }),
      loadDareV2Rows(db),
      db.bucksDareTarget.count(),
      db.bucksDareContribution.count(),
      db.bucksDareGame.count(),
    ]);
  console.log("== Dare v1 (BucksDare) by state");
  if (v1ByState.length === 0) console.log("  (no rows)");
  for (const row of v1ByState) {
    console.log(`  ${row.dareState}: ${row._count._all.toString()}`);
  }
  console.log(
    `  targets=${v1Targets.toString()} contributions=${v1Contributions.toString()} games=${v1Games.toString()}`,
  );
  console.log("== Dare v2/v3 (BucksDareV2) by dialect and state");
  for (const dare of v2Rows) {
    console.log(
      `  #${dare.id.toString()} state=${dare.dareState} pot=${dare.potTotal.toString()} compiler=${effectiveCompilerVersion(dare)}`,
    );
  }
  if (v2Rows.length === 0) console.log("  (no rows)");
}

async function drainV1(
  apply: boolean,
  db: ExtendedPrismaClient = prisma,
): Promise<void> {
  const open = await db.bucksDare.findMany({
    where: { dareState: { in: [...OPEN_V1_STATES] } },
    include: {
      targets: { orderBy: { id: "asc" } },
    },
    orderBy: { id: "asc" },
  });
  for (const row of open) {
    console.log(
      `v1 #${row.id.toString()} state=${row.dareState} pot=${row.potTotal.toString()} -> ${row.dareState === "proposed" ? "abandon" : row.dareState === "pending_accept" ? "expire+refund" : "void+refund"}`,
    );
  }
  if (!apply || open.length === 0) return;
  const proposedIds = open
    .filter((row) => row.dareState === "proposed")
    .map((row) => row.id);
  if (proposedIds.length > 0) {
    const proposedContributionCount = await db.bucksDareContribution.count({
      where: { dareId: { in: proposedIds } },
    });
    if (proposedContributionCount !== 0) {
      throw new Error(
        `Refusing to abandon ${proposedContributionCount.toString()} contribution(s) attached to v1 proposed dares; repair the financial data first`,
      );
    }
  }
  // Proposed and pending_accept dares drain through the shipped sweep
  // helpers; the far-future horizon makes every deadline count as lapsed.
  await abandonExpiredDareProposals(db, DRAIN_HORIZON);
  await expireDareAcceptWindows(db, DRAIN_HORIZON);
  const remainingUnsettled = await db.bucksDare.count({
    where: { dareState: { in: ["proposed", "pending_accept"] } },
  });
  if (remainingUnsettled !== 0) {
    throw new Error(
      `${remainingUnsettled.toString()} v1 proposal(s) or acceptance window(s) remained after the sweep; re-run --void`,
    );
  }
  const active = await db.bucksDare.findMany({
    where: { dareState: "active" },
    include: { targets: { orderBy: { id: "asc" } } },
    orderBy: { id: "asc" },
  });
  for (const row of active) {
    const summary = await voidDareWithFullRefund(
      dareRefundView(row),
      db,
      new Date(),
      { voidReason: "version_retired", surface: "sweep" },
    );
    if (summary === undefined) {
      throw new Error(`v1 dare ${row.id.toString()} could not be voided`);
    }
    console.log(
      `v1 #${row.id.toString()} voided; refunded pot=${summary.potTotal.toString()}`,
    );
  }
}

async function drainV2(
  apply: boolean,
  db: ExtendedPrismaClient = prisma,
): Promise<void> {
  const preV3 = (await loadDareV2Rows(db)).filter((dare) => isPreV3(dare));
  for (const dare of preV3) {
    const action =
      dare.dareState === "draft"
        ? "delete draft"
        : dare.dareState === "pending_accept"
          ? "cancel+refund"
          : dare.dareState === "activating" || dare.dareState === "active"
            ? "void+refund"
            : "leave (terminal; purge removes the row)";
    console.log(
      `v2 #${dare.id.toString()} state=${dare.dareState} pot=${dare.potTotal.toString()} compiler=${effectiveCompilerVersion(dare)} -> ${action}`,
    );
  }
  if (!apply) return;
  for (const dare of preV3) {
    if (dare.dareState === "draft") {
      if (dare.potTotal !== 0) {
        throw new Error(
          `Draft dare ${dare.id.toString()} unexpectedly holds a pot of ${dare.potTotal.toString()} BB`,
        );
      }
      if (dare.contributions.length !== 0) {
        throw new Error(
          `Draft dare ${dare.id.toString()} has ${dare.contributions.length.toString()} contribution(s) despite a zero pot; repair the financial data first`,
        );
      }
      // Conditional claim: a live beta could fund this draft between the
      // read and this write, and an id-only update would then bury an
      // escrowed pot. Losing the claim is a hard stop — re-run the drain.
      const claim = await db.bucksDareV2.updateMany({
        where: {
          id: dare.id,
          dareState: "draft",
          potTotal: 0,
          currentRevision: dare.currentRevision,
        },
        data: { dareState: "deleted" },
      });
      if (claim.count !== 1) {
        throw new Error(
          `Draft dare ${dare.id.toString()} changed state mid-run; re-run --void`,
        );
      }
      continue;
    }
    if (dare.dareState === "pending_accept") {
      const outcome = await db.$transaction(
        async (tx) =>
          await cancelDareV2InTransaction(tx, {
            dareId: dare.id,
            revision: dare.fundedRevision ?? dare.currentRevision,
            actorDiscordId: DiscordAccountIdSchema.parse(
              dare.challengerDiscordId,
            ),
            now: new Date(),
          }),
      );
      if (outcome.kind !== "cancelled") {
        throw new Error(
          `v2 dare ${dare.id.toString()} could not be cancelled: ${outcome.kind}`,
        );
      }
      console.log(
        `v2 #${dare.id.toString()} cancelled; refunded pot=${outcome.potTotal.toString()}`,
      );
      continue;
    }
    if (dare.dareState === "activating" || dare.dareState === "active") {
      const voided = await voidDareV2WithFullRefund(
        dare,
        "version_retired",
        db,
      );
      if (!voided) {
        throw new Error(`v2 dare ${dare.id.toString()} could not be voided`);
      }
      console.log(
        `v2 #${dare.id.toString()} voided; refunded pot=${dare.potTotal.toString()}`,
      );
    }
  }
}

/** True when nothing open remains on any pre-v3 dialect. */
async function verify(db: ExtendedPrismaClient = prisma): Promise<boolean> {
  await assertKnownDareStates(db);
  await assertKnownCompilerVersions(db);
  const openV1 = await db.bucksDare.count({
    where: { dareState: { in: [...OPEN_V1_STATES] } },
  });
  const openPreV3 = (await loadDareV2Rows(db)).filter(
    (dare) =>
      isPreV3(dare) &&
      (dare.dareState === "draft" || OPEN_V2_STATE_SET.has(dare.dareState)),
  );
  console.log(`open v1 dares: ${openV1.toString()}`);
  console.log(`open pre-v3 v2 dares: ${openPreV3.length.toString()}`);
  for (const dare of openPreV3) {
    console.log(`  #${dare.id.toString()} state=${dare.dareState}`);
  }
  return openV1 === 0 && openPreV3.length === 0;
}

async function purge(
  apply: boolean,
  db: ExtendedPrismaClient = prisma,
  writesQuiesced = false,
): Promise<void> {
  if (apply && !writesQuiesced) {
    throw new Error(
      "Refusing to purge without --writes-quiesced: disable dare_v2 and bucks_dares_enabled in Flipt for every guild first (and keep both disabled until the retirement PRs deploy), then re-run with the flag",
    );
  }
  if (!(await verify(db))) {
    throw new Error("Refusing to purge while open pre-v3 dares remain");
  }
  const allDares = await loadDareV2Rows(db);
  const preV3Ids = allDares
    .filter((dare) => isPreV3(dare))
    .map((dare) => dare.id);
  // A v3-effective dare may still carry superseded pre-v3 draft revisions
  // (revised into v3 before funding). Those rows are draft history — never
  // the governing revision — and must go BEFORE the deletes, or the final
  // no-pre-v3-revisions assertion would fail after a partial purge.
  const supersededRevisions: Array<{
    id: number;
    dareId: number;
    revision: number;
  }> = [];
  for (const dare of allDares) {
    if (isPreV3(dare)) continue;
    const governing = dare.fundedRevision ?? dare.currentRevision;
    for (const revision of dare.revisions) {
      if (revision.compilerVersion === DARE_SQL_V3_COMPILER) continue;
      if (revision.revision === governing) {
        throw new Error(
          `Dare ${dare.id.toString()} is v3-effective but its governing revision is pre-v3`,
        );
      }
      if (!PRE_V3_COMPILERS.has(revision.compilerVersion)) {
        throw new Error(
          `Dare ${dare.id.toString()} revision ${revision.revision.toString()} has unrecognized compiler version "${revision.compilerVersion}"`,
        );
      }
      supersededRevisions.push({
        id: revision.id,
        dareId: dare.id,
        revision: revision.revision,
      });
      console.log(
        `superseded pre-v3 revision: dare #${dare.id.toString()} revision ${revision.revision.toString()} (${revision.compilerVersion})`,
      );
    }
  }
  const [v1Count, intentTotal, intentDareBound] = await Promise.all([
    db.bucksDare.count(),
    db.confirmationIntent.count(),
    db.confirmationIntent.count({ where: { dareId: { not: null } } }),
  ]);
  const nonDareIntentIdsBefore = await db.confirmationIntent.findMany({
    where: { dareId: null },
    select: { id: true },
  });
  console.log(
    `would delete: ${v1Count.toString()} BucksDare rows (cascades to targets/contributions/games)`,
  );
  console.log(
    `would delete: ${preV3Ids.length.toString()} pre-v3 BucksDareV2 rows [${preV3Ids.join(", ")}] (cascades to revisions/targets/contributions/evidence/activations/dare-bound intents/notifications)`,
  );
  const staleRevisionIntentWhere = {
    OR: supersededRevisions.map(({ dareId, revision }) => ({
      dareId,
      expectedRevision: revision,
    })),
  };
  const staleRevisionIntentCount =
    supersededRevisions.length === 0
      ? 0
      : await db.confirmationIntent.count({ where: staleRevisionIntentWhere });
  console.log(
    `would delete: ${staleRevisionIntentCount.toString()} confirmation intents targeting superseded pre-v3 revisions`,
  );
  console.log(
    `confirmation intents before: total=${intentTotal.toString()} dare-bound=${intentDareBound.toString()}`,
  );
  if (!apply) return;
  const deletedStaleRevisionIntents =
    supersededRevisions.length === 0
      ? 0
      : (
          await db.confirmationIntent.deleteMany({
            where: staleRevisionIntentWhere,
          })
        ).count;
  const deletedRevisions = await db.bucksDareV2Revision.deleteMany({
    where: { id: { in: supersededRevisions.map(({ id }) => id) } },
  });
  // Terminal-state-conditioned deletes: a dare opened or funded between the
  // verify read and this write must survive and fail the count assertion,
  // never be cascade-deleted with an unrefunded pot.
  const deletedV1 = await db.bucksDare.deleteMany({
    where: { dareState: { in: TERMINAL_V1_STATES } },
  });
  const v1Remaining = await db.bucksDare.count();
  if (v1Remaining !== 0) {
    throw new Error(
      `${v1Remaining.toString()} v1 dare(s) appeared or reopened mid-purge; drain again before re-running`,
    );
  }
  const deletedV2 = await db.bucksDareV2.deleteMany({
    where: { id: { in: preV3Ids }, dareState: { in: TERMINAL_V2_STATES } },
  });
  if (deletedV2.count !== preV3Ids.length) {
    throw new Error(
      `Claimed ${deletedV2.count.toString()} of ${preV3Ids.length.toString()} pre-v3 dares; some changed state mid-purge — drain again before re-running`,
    );
  }
  console.log(
    `deleted ${deletedRevisions.count.toString()} superseded pre-v3 revisions from retained v3 dares`,
  );
  console.log(
    `deleted ${deletedStaleRevisionIntents.toString()} confirmation intents targeting superseded pre-v3 revisions`,
  );
  const [intentTotalAfter, intentDareBoundAfter, revisionsLeft] =
    await Promise.all([
      db.confirmationIntent.count(),
      db.confirmationIntent.count({ where: { dareId: { not: null } } }),
      db.bucksDareV2Revision.count({
        where: { compilerVersion: { not: DARE_SQL_V3_COMPILER } },
      }),
    ]);
  const nonDareIntentIdsAfter = await db.confirmationIntent.findMany({
    where: { dareId: null },
    select: { id: true },
  });
  console.log(
    `deleted ${deletedV1.count.toString()} BucksDare rows and ${deletedV2.count.toString()} BucksDareV2 rows`,
  );
  console.log(
    `confirmation intents after: total=${intentTotalAfter.toString()} dare-bound=${intentDareBoundAfter.toString()}`,
  );
  if (revisionsLeft !== 0) {
    throw new Error(
      `${revisionsLeft.toString()} pre-v3 revisions remain after purge`,
    );
  }
  const nonDareIntentIdsAfterSet = new Set(
    nonDareIntentIdsAfter.map(({ id }) => id),
  );
  const removedNonDareIntent = nonDareIntentIdsBefore.find(
    ({ id }) => !nonDareIntentIdsAfterSet.has(id),
  );
  if (removedNonDareIntent !== undefined) {
    throw new Error(
      `Non-dare confirmation intent ${removedNonDareIntent.id.toString()} disappeared; the cascade touched a row it must not`,
    );
  }
}

export { drainV1, drainV2, purge, report, verify };

async function main(): Promise<void> {
  const args = parseArgs(Bun.argv.slice(2));
  console.log(
    `retire-dare-v1-v2: phase=${args.phase} ${args.apply ? "APPLY" : "dry run"}`,
  );
  switch (args.phase) {
    case "report":
      await report();
      break;
    case "void":
      await drainV1(args.apply);
      await drainV2(args.apply);
      break;
    case "verify": {
      const clean = await verify();
      if (!clean) {
        process.exitCode = 1;
        console.log("VERIFY FAILED: open pre-v3 dares remain");
        return;
      }
      console.log("VERIFY OK: no open pre-v3 dares");
      break;
    }
    case "purge":
      await purge(args.apply, prisma, args.writesQuiesced);
      break;
  }
}

if (import.meta.main) {
  try {
    await main();
  } finally {
    await prisma.$disconnect();
  }
}
