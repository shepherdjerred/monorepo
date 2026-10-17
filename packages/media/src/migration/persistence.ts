import { z } from "zod";
import type { MediaActor } from "#application/auth.ts";
import { MediaError, requireOwner } from "#application/errors.ts";
import type { Database } from "#infrastructure/database.ts";
import { MediaCommandBase } from "#infrastructure/command-base.ts";
import { isRetryableTransaction } from "#infrastructure/locks.ts";
import {
  MigrationProposalSchema,
  MigrationProposalListSchema,
  ReviewMigrationSchema,
  UploadMigrationSchema,
  MAX_MIGRATION_RECORDS,
} from "#shared/migration.ts";
import {
  validateCapture,
  recordKey,
} from "#migration/capture/capture-validation.ts";
import { normalizeCapture } from "./normalize.ts";
import { snapshotHash } from "./profile-import.ts";
import { lockLegacyRequesterBindings } from "#infrastructure/recovery/legacy-claims/bindings.ts";
import { migrationTargets } from "./catalog-targets.ts";
import { PrismaMigrationBundles } from "./bundle-persistence.ts";
import type { MigrationCatalogDiscovery } from "./catalog-discovery.ts";
import type { DiscoverMigrationCatalogSchema } from "#shared/migration-catalog.ts";
function proposal(row: {
  id: string;
  captureId: string;
  reportHash: string;
  recoveryEpoch: number;
  runtimeVersion: number;
  version: number;
  status: string;
  createdAt: Date;
  report: unknown;
  capture: {
    manifestHash: string;
    sourceKind: string;
    sourceInstanceId: string;
    sourceVersion: string;
  };
}) {
  return MigrationProposalSchema.parse({
    source: {
      kind: row.capture.sourceKind,
      instanceId: row.capture.sourceInstanceId,
      version: row.capture.sourceVersion,
    },
    id: row.id,
    captureId: row.captureId,
    reportHash: row.reportHash,
    recoveryEpoch: row.recoveryEpoch,
    runtimeVersion: row.runtimeVersion,
    version: row.version,
    status: row.status,
    report: row.report,
    captureHash: row.capture.manifestHash,
    createdAt: row.createdAt.toISOString(),
  });
}
export class PrismaMigrationAdministration extends MediaCommandBase {
  readonly bundles: PrismaMigrationBundles;
  constructor(
    private readonly db: Database,
    private readonly discovery?: MigrationCatalogDiscovery,
  ) {
    super(db, { keepDays: 30 });
    this.bundles = new PrismaMigrationBundles(db);
  }
  async discover(
    actor: MediaActor,
    captureId: string,
    input: z.input<typeof DiscoverMigrationCatalogSchema>,
  ) {
    requireOwner(actor);
    if (this.discovery === undefined)
      throw new MediaError(
        "catalog_discovery_unavailable",
        "Catalog discovery is not configured",
        503,
      );
    return await this.discovery.discover(actor, captureId, input);
  }
  async list(actor: MediaActor) {
    requireOwner(actor);
    const rows = await this.db.adoptionProposal.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        captureId: true,
        reportHash: true,
        recoveryEpoch: true,
        runtimeVersion: true,
        version: true,
        status: true,
        createdAt: true,
        capture: {
          select: {
            manifestHash: true,
            sourceKind: true,
            sourceInstanceId: true,
            sourceVersion: true,
          },
        },
      },
    });
    return MigrationProposalListSchema.parse(
      rows.map(({ capture, ...row }) => ({
        ...row,
        captureHash: capture.manifestHash,
        source: {
          kind: capture.sourceKind,
          instanceId: capture.sourceInstanceId,
          version: capture.sourceVersion,
        },
        createdAt: row.createdAt.toISOString(),
      })),
    );
  }
  async detail(actor: MediaActor, id: string) {
    requireOwner(actor);
    return proposal(
      await this.db.adoptionProposal.findUniqueOrThrow({
        where: { id },
        include: {
          capture: {
            select: {
              manifestHash: true,
              sourceKind: true,
              sourceInstanceId: true,
              sourceVersion: true,
            },
          },
        },
      }),
    );
  }
  async upload(
    actor: MediaActor,
    value: z.infer<typeof UploadMigrationSchema>,
  ) {
    requireOwner(actor);
    const capture = validateCapture(
      UploadMigrationSchema.parse(value).snapshot,
    );
    const upload = () =>
      this.db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR SHARE`;
          const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
            where: { id: "singleton" },
          });
          const requesters = await tx.mediaUser.findMany({
            select: { id: true, plexAccountId: true },
            take: MAX_MIGRATION_RECORDS,
          });
          const report = normalizeCapture(capture.snapshot, {
            targets: await migrationTargets(tx),
            requesters: requesters.map((user) => ({
              userId: user.id,
              plexAccountId: user.plexAccountId,
            })),
          });
          await lockLegacyRequesterBindings(tx);
          const stored = await tx.migrationCapture.upsert({
            where: { manifestHash: capture.captureHash },
            update: {},
            create: {
              schemaVersion: 1,
              sourceInstanceId: capture.snapshot.sourceInstanceId,
              sourceKind: capture.snapshot.sourceKind,
              sourceVersion: capture.snapshot.sourceVersion,
              startedAt: new Date(capture.snapshot.startedAt),
              completedAt: new Date(capture.snapshot.completedAt),
              complete: capture.complete,
              stable: capture.stable,
              manifestHash: capture.captureHash,
              manifest: capture.snapshot,
              records: {
                create: capture.snapshot.records.map((record) => ({
                  provenanceKey: recordKey(capture.snapshot, record),
                  kind: record.kind,
                  sourceId: record.sourceId,
                  observationHash: snapshotHash(z.json().parse(record)),
                  payload: record,
                })),
              },
            },
          });
          const row = await tx.adoptionProposal.upsert({
            where: {
              captureId_reportHash_recoveryEpoch_runtimeVersion: {
                captureId: stored.id,
                reportHash: report.reportHash,
                recoveryEpoch: runtime.recoveryEpoch,
                runtimeVersion: runtime.version,
              },
            },
            update: {},
            create: {
              captureId: stored.id,
              reportHash: report.reportHash,
              report,
              recoveryEpoch: runtime.recoveryEpoch,
              runtimeVersion: runtime.version,
              status:
                capture.complete && capture.stable
                  ? "awaiting_review"
                  : "protected",
            },
            include: {
              capture: {
                select: {
                  manifestHash: true,
                  sourceKind: true,
                  sourceInstanceId: true,
                  sourceVersion: true,
                },
              },
            },
          });
          return proposal(row);
        },
        { isolationLevel: "RepeatableRead", timeout: 30_000 },
      );
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await upload();
      } catch (error) {
        if (isRetryableTransaction(error) && attempt < 3) continue;
        throw error;
      }
    }
    throw new Error("Capture transaction retry limit was not enforced");
  }
  async review(
    actor: MediaActor,
    key: string,
    id: string,
    value: z.infer<typeof ReviewMigrationSchema>,
  ) {
    requireOwner(actor);
    const input = ReviewMigrationSchema.parse(value);
    return await this.command(
      actor,
      key,
      { kind: "review_migration", input: { id, ...input } },
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR SHARE`;
        await tx.$queryRaw`SELECT id FROM "AdoptionProposal" WHERE id = ${id} FOR UPDATE`;
        const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
          where: { id: "singleton" },
        });
        const row = await tx.adoptionProposal.findUniqueOrThrow({
          where: { id },
          include: { capture: true },
        });
        if (
          row.version !== input.expectedVersion ||
          row.reportHash !== input.reportHash ||
          row.capture.manifestHash !== input.captureHash ||
          row.recoveryEpoch !== input.recoveryEpoch ||
          row.runtimeVersion !== input.runtimeVersion ||
          runtime.recoveryEpoch !== input.recoveryEpoch ||
          runtime.version !== input.runtimeVersion
        )
          throw new MediaError(
            "migration_review_stale",
            "Capture, report or runtime changed; upload and review again",
            409,
          );
        if (
          input.action === "approve" &&
          (!row.capture.complete ||
            !row.capture.stable ||
            row.status === "protected")
        )
          throw new MediaError(
            "migration_capture_protected",
            "Incomplete or changing captures cannot be approved",
            409,
          );
        await tx.adoptionProposal.update({
          where: { id },
          data: {
            status: input.action === "approve" ? "approved" : "revoked",
            actorId: actor.id,
            approvedAt: input.action === "approve" ? new Date() : null,
            version: { increment: 1 },
          },
        });
        await tx.applicationEvent.create({
          data: {
            actorId: actor.id,
            kind: "migration_review_recorded",
            payload: {
              proposalId: id,
              reportHash: row.reportHash,
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
