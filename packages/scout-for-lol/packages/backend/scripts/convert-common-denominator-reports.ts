#!/usr/bin/env bun
/**
 * One-time migration: retire the in-code COMMON_DENOMINATOR report seeding.
 *
 * The "Common Denominator" reports were originally seeded + re-synced from code
 * (see reports/system-reports.ts, now removed). They live in the DB and should
 * become ordinary, user-editable reports. This script:
 *
 *   1. DELETES the two ARAM group reports (genuinely low-volume; the user asked
 *      to remove them). Deleting a Report cascades its ReportRun history.
 *   2. CONVERTS the remaining COMMON_DENOMINATOR rows (Ranked + Arena groups,
 *      surrender leaders) to normal reports: isSystemManaged=false,
 *      systemSource=null, isEnabled=true. They keep their id, queryText, cron,
 *      and run history, and become editable/deletable in the web + Discord UIs.
 *
 * After this runs, `syncSystemReports` no longer touches them (it only manages
 * COMPETITION rows), so they persist as plain DB reports.
 *
 * Idempotent: it only acts on rows still tagged systemSource='COMMON_DENOMINATOR',
 * so a second run is a no-op.
 *
 * Usage:
 *   bun run scripts/convert-common-denominator-reports.ts [--dry-run] [--owner-id <discordId>]
 *
 * Requires the same env as the backend pod (DATABASE_URL). Easiest to run via
 * `kubectl exec` into the scout-beta backend pod (prod has no CD rows).
 */
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import { prisma } from "#src/database/index.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("convert-common-denominator-reports");

const dryRun = Bun.argv.includes("--dry-run");
const ownerIdArgIndex = Bun.argv.indexOf("--owner-id");
const ownerId =
  ownerIdArgIndex !== -1
    ? DiscordAccountIdSchema.parse(Bun.argv[ownerIdArgIndex + 1])
    : undefined;

async function main(): Promise<void> {
  const cdReports = await prisma.report.findMany({
    where: { systemSource: "COMMON_DENOMINATOR" },
    select: { id: true, title: true, isSystemManaged: true, isEnabled: true },
    orderBy: { id: "asc" },
  });

  if (cdReports.length === 0) {
    logger.info("No COMMON_DENOMINATOR reports found — nothing to do.");
    return;
  }

  const aramReports = cdReports.filter((report) =>
    report.title.includes("ARAM"),
  );
  const keepers = cdReports.filter((report) => !report.title.includes("ARAM"));

  logger.info("Found COMMON_DENOMINATOR reports", {
    total: cdReports.length,
    toDelete: aramReports.map(
      (report) => `#${report.id.toString()} ${report.title}`,
    ),
    toConvert: keepers.map(
      (report) => `#${report.id.toString()} ${report.title}`,
    ),
    ownerIdReassignment: ownerId ?? "(unchanged)",
    dryRun,
  });

  if (dryRun) {
    logger.info("--dry-run: no changes written.");
    return;
  }

  const now = new Date();

  // Delete + convert run in one transaction: if the connection drops or the
  // process is killed mid-migration, either both steps commit or neither
  // does. Without this, a kill right after deleteMany would permanently lose
  // the ARAM reports (and their cascaded ReportRun history) while leaving the
  // remaining rows still tagged COMMON_DENOMINATOR.
  const { deleted, converted } = await prisma.$transaction(async (tx) => {
    // 1. Delete the ARAM reports (cascades ReportRun).
    const deletedResult = await tx.report.deleteMany({
      where: {
        systemSource: "COMMON_DENOMINATOR",
        title: { contains: "ARAM" },
      },
    });

    // 2. Convert the remaining rows to normal, editable reports. Re-enable
    //    them too, in case an interim sync tick had already disabled them.
    const convertedResult = await tx.report.updateMany({
      where: { systemSource: "COMMON_DENOMINATOR" },
      data: {
        isSystemManaged: false,
        systemSource: null,
        isEnabled: true,
        updatedTime: now,
        ...(ownerId === undefined ? {} : { ownerId }),
      },
    });

    return { deleted: deletedResult, converted: convertedResult };
  });

  logger.info("Done.", { deleted: deleted.count, converted: converted.count });
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
