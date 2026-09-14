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
 *   bun run scripts/retire/retire-dare-v1-v2.ts --purge --apply    # delete
 *
 * Money movement always goes through the shipped refund paths while they
 * still exist — v1 sweep/void helpers and the v2 cancel/void transactions —
 * never through hand-rolled ledger writes. Purge refuses to run unless the
 * verify predicate passes in the same invocation, and reports the dare-bound
 * ConfirmationIntent count so the cascade provably left the report and
 * subscription intents alone.
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
import { DiscordAccountIdSchema } from "@scout-for-lol/data";

const DARE_SQL_V3_COMPILER = "dare-scoutql-3";

/** Far enough in the future that every proposal/accept deadline has lapsed. */
const DRAIN_HORIZON = new Date("2100-01-01T00:00:00Z");

const OPEN_V1_STATES = ["proposed", "pending_accept", "active"] as const;
const OPEN_V2_STATES = ["pending_accept", "activating", "active"] as const;

const ArgsSchema = z.strictObject({
  apply: z.boolean(),
  phase: z.enum(["report", "void", "verify", "purge"]),
});

function parseArgs(argv: readonly string[]) {
  const known = new Set(["--apply", "--void", "--verify", "--purge"]);
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
    phase: phases[0]?.slice(2) ?? "report",
  });
}

type DareV2WithRevisions = Awaited<ReturnType<typeof loadDareV2Rows>>[number];

async function loadDareV2Rows(db: ExtendedPrismaClient) {
  return await db.bucksDareV2.findMany({
    include: {
      targets: true,
      revisions: { select: { revision: true, compilerVersion: true } },
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

function isPreV3(dare: DareV2WithRevisions): boolean {
  return effectiveCompilerVersion(dare) !== DARE_SQL_V3_COMPILER;
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
    include: { targets: { orderBy: { id: "asc" } } },
    orderBy: { id: "asc" },
  });
  for (const row of open) {
    console.log(
      `v1 #${row.id.toString()} state=${row.dareState} pot=${row.potTotal.toString()} -> ${row.dareState === "proposed" ? "abandon" : row.dareState === "pending_accept" ? "expire+refund" : "void+refund"}`,
    );
  }
  if (!apply || open.length === 0) return;
  // Proposed and pending_accept dares drain through the shipped sweep
  // helpers; the far-future horizon makes every deadline count as lapsed.
  await abandonExpiredDareProposals(db, DRAIN_HORIZON);
  await expireDareAcceptWindows(db, DRAIN_HORIZON);
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
      await db.bucksDareV2.update({
        where: { id: dare.id },
        data: { dareState: "deleted" },
      });
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
  const openV1 = await db.bucksDare.count({
    where: { dareState: { in: [...OPEN_V1_STATES] } },
  });
  const openPreV3 = (await loadDareV2Rows(db)).filter(
    (dare) =>
      isPreV3(dare) &&
      (dare.dareState === "draft" ||
        (OPEN_V2_STATES as readonly string[]).includes(dare.dareState)),
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
): Promise<void> {
  if (!(await verify(db))) {
    throw new Error("Refusing to purge while open pre-v3 dares remain");
  }
  const preV3Ids = (await loadDareV2Rows(db))
    .filter((dare) => isPreV3(dare))
    .map((dare) => dare.id);
  const [v1Count, intentTotal, intentDareBound] = await Promise.all([
    db.bucksDare.count(),
    db.confirmationIntent.count(),
    db.confirmationIntent.count({ where: { dareId: { not: null } } }),
  ]);
  console.log(
    `would delete: ${v1Count.toString()} BucksDare rows (cascades to targets/contributions/games)`,
  );
  console.log(
    `would delete: ${preV3Ids.length.toString()} pre-v3 BucksDareV2 rows [${preV3Ids.join(", ")}] (cascades to revisions/targets/contributions/evidence/activations/dare-bound intents/notifications)`,
  );
  console.log(
    `confirmation intents before: total=${intentTotal.toString()} dare-bound=${intentDareBound.toString()}`,
  );
  if (!apply) return;
  const deletedV1 = await db.bucksDare.deleteMany({});
  const deletedV2 = await db.bucksDareV2.deleteMany({
    where: { id: { in: preV3Ids } },
  });
  const [intentTotalAfter, intentDareBoundAfter, revisionsLeft] =
    await Promise.all([
      db.confirmationIntent.count(),
      db.confirmationIntent.count({ where: { dareId: { not: null } } }),
      db.bucksDareV2Revision.count({
        where: { compilerVersion: { not: DARE_SQL_V3_COMPILER } },
      }),
    ]);
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
  const nonDareBefore = intentTotal - intentDareBound;
  const nonDareAfter = intentTotalAfter - intentDareBoundAfter;
  if (nonDareBefore !== nonDareAfter) {
    throw new Error(
      `Non-dare confirmation intents changed (${nonDareBefore.toString()} -> ${nonDareAfter.toString()}); the cascade touched rows it must not`,
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
      await purge(args.apply);
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
