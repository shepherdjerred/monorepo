import type { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import { requireOwner, MediaError } from "#application/errors.ts";
import type { Database } from "#infrastructure/database.ts";
import { MediaCommandBase } from "#infrastructure/command-base.ts";
import {
  MAX_MIGRATION_RECORDS,
  MigrationSnapshotSchema,
} from "#shared/migration.ts";
import {
  CreateBundleSchema,
  ReviewBundleSchema,
  BundleReviewSchema,
  BundleReportSchema,
} from "#shared/migration-handoff.ts";
import { buildMigrationBundle, validateBundleSelection } from "./bundle.ts";
import { migrationTargets } from "./catalog-targets.ts";

function dto(row: {
  id: string;
  bundleId: string;
  report: unknown;
  selection: unknown;
  recoveryEpoch: number;
  runtimeVersion: number;
  status: string;
  version: number;
  createdAt: Date;
  bundle: { manifest: unknown };
}) {
  return BundleReviewSchema.parse({
    id: row.id,
    bundleId: row.bundleId,
    manifest: row.bundle.manifest,
    report: row.report,
    selection: row.selection,
    recoveryEpoch: row.recoveryEpoch,
    runtimeVersion: row.runtimeVersion,
    status: row.status,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
  });
}
export class PrismaMigrationBundles extends MediaCommandBase {
  constructor(private readonly db: Database) {
    super(db, { keepDays: 30 });
  }
  async create(actor: MediaActor, value: z.input<typeof CreateBundleSchema>) {
    requireOwner(actor);
    const input = CreateBundleSchema.parse(value);
    if (new Set(input.captureIds).size !== input.captureIds.length)
      throw new MediaError("invalid_bundle", "Capture IDs must be unique", 422);
    return await this.db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR SHARE`;
        const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
          where: { id: "singleton" },
        });
        const captures = await tx.migrationCapture.findMany({
          where: { id: { in: input.captureIds } },
        });
        if (captures.length !== input.captureIds.length)
          throw new MediaError(
            "invalid_bundle",
            "A selected capture is absent",
            422,
          );
        const users = await tx.mediaUser.findMany({
          take: MAX_MIGRATION_RECORDS + 1,
          select: { id: true, plexAccountId: true },
        });
        const context = {
          targets: await migrationTargets(tx),
          requesters: users.map((user) => ({
            userId: user.id,
            plexAccountId: user.plexAccountId,
          })),
          rootMappings: input.rootMappings,
        };
        if (context.requesters.length > MAX_MIGRATION_RECORDS)
          throw new MediaError(
            "migration_limit",
            "Requester inventory exceeds bound",
            422,
          );
        const { manifest, report } = buildMigrationBundle(
          captures.map((capture) => ({
            id: capture.id,
            snapshot: MigrationSnapshotSchema.parse(capture.manifest),
          })),
          context,
        );
        const bundle = await tx.migrationBundle.upsert({
          where: { bundleHash: manifest.bundleHash },
          update: {},
          create: {
            bundleHash: manifest.bundleHash,
            manifest,
            captures: {
              create: input.captureIds.map((captureId) => ({ captureId })),
            },
          },
        });
        const row = await tx.migrationBundleReview.upsert({
          where: {
            bundleId_reportHash_recoveryEpoch_runtimeVersion: {
              bundleId: bundle.id,
              reportHash: report.reportHash,
              recoveryEpoch: runtime.recoveryEpoch,
              runtimeVersion: runtime.version,
            },
          },
          update: {},
          create: {
            bundleId: bundle.id,
            reportHash: report.reportHash,
            report,
            selection: [],
            recoveryEpoch: runtime.recoveryEpoch,
            runtimeVersion: runtime.version,
            status:
              manifest.complete && manifest.stable
                ? "awaiting_review"
                : "protected",
          },
          include: { bundle: true },
        });
        return dto(row);
      },
      { isolationLevel: "RepeatableRead", timeout: 30_000 },
    );
  }
  async detail(actor: MediaActor, id: string) {
    requireOwner(actor);
    return dto(
      await this.db.migrationBundleReview.findUniqueOrThrow({
        where: { id },
        include: { bundle: true },
      }),
    );
  }
  async list(actor: MediaActor) {
    requireOwner(actor);
    return await this.db.migrationBundleReview.findMany({
      take: 100,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        reportHash: true,
        status: true,
        version: true,
        createdAt: true,
      },
    });
  }
  async review(
    actor: MediaActor,
    key: string,
    id: string,
    value: z.infer<typeof ReviewBundleSchema>,
  ) {
    requireOwner(actor);
    const input = ReviewBundleSchema.parse(value);
    return await this.command(
      actor,
      key,
      { kind: "review_migration_bundle", input: { id, ...input } },
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR SHARE`;
        await tx.$queryRaw`SELECT id FROM "MigrationBundleReview" WHERE id = ${id} FOR UPDATE`;
        const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
          where: { id: "singleton" },
        });
        const row = await tx.migrationBundleReview.findUniqueOrThrow({
          where: { id },
          include: { bundle: true },
        });
        if (
          row.version !== input.expectedVersion ||
          row.reportHash !== input.reportHash ||
          row.bundle.bundleHash !== input.bundleHash ||
          row.recoveryEpoch !== input.recoveryEpoch ||
          row.runtimeVersion !== input.runtimeVersion ||
          runtime.recoveryEpoch !== input.recoveryEpoch ||
          runtime.version !== input.runtimeVersion
        )
          throw new MediaError(
            "migration_review_stale",
            "Bundle, report or runtime changed; regenerate review",
            409,
          );
        const report = BundleReportSchema.parse(row.report);
        if (
          input.action === "approve" &&
          (!report.complete || !report.stable || input.selected.length === 0)
        )
          throw new MediaError(
            "migration_bundle_protected",
            "A complete stable bundle and an explicit eligible selection are required",
            409,
          );
        let selected;
        try {
          selected = validateBundleSelection(report, input.selected);
        } catch {
          throw new MediaError(
            "migration_selection_protected",
            "Selection contains protected, absent or changed records",
            409,
          );
        }
        await tx.migrationBundleReview.update({
          where: { id },
          data: {
            status: input.action === "approve" ? "approved" : "revoked",
            selection: selected,
            actorId: actor.id,
            approvedAt: input.action === "approve" ? new Date() : null,
            version: { increment: 1 },
          },
        });
        await tx.applicationEvent.create({
          data: {
            actorId: actor.id,
            kind: "migration_bundle_reviewed",
            payload: {
              reviewId: id,
              bundleHash: input.bundleHash,
              reportHash: input.reportHash,
              action: input.action,
              ownershipTransferred: false,
            },
          },
        });
        return { status: "completed", version: row.version + 1 };
      },
    );
  }
}
