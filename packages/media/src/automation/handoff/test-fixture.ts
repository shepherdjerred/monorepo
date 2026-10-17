import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import { CredentialCipher } from "#application/security.ts";
import type { MediaActor } from "#application/auth.ts";
import { networkFixture } from "#migration/handoff-network/test-fixture.ts";
import { observeClaims } from "#migration/handoff-network/claims.ts";
import { readHandoffPlan } from "#migration/handoff-network/plan.ts";
import { fileFixture } from "#automation/files/test-support.ts";
import {
  importResolvedProfiles,
  snapshotHash,
} from "#migration/profile-import.ts";
import snapshot from "#migration/fixtures/resolved-profiles.json";
import {
  MigrationBundleSchema,
  BundleReportSchema,
} from "#shared/migration-handoff.ts";
import {
  PrepareHandoffSchema,
  HandoffNetworkEvidenceSchema,
} from "#shared/handoff.ts";
import { QualityRulesSchema } from "#shared/api.ts";
import { PrismaMediaHandoff } from "#infrastructure/handoff/service.ts";
import { LEGACY_OBSERVER_CONFIG } from "#integrations/legacy-observer/config.ts";
import { prepareHandoffFiles } from "./files.ts";
import { finishHandoffPreparation } from "./plan.ts";

export async function handoffFixture(
  db: Database,
  options: {
    subtitlePolicyResolution?: "unresolved" | "require_simplified";
    extendReport?: (input: {
      report: z.infer<typeof BundleReportSchema>;
      manifest: z.infer<typeof MigrationBundleSchema>;
      target: string;
    }) => Promise<void>;
  } = {},
) {
  const file = await fileFixture(db);
  const network = await networkFixture(
    db,
    new CredentialCipher(Buffer.alloc(32, 7).toString("base64")),
  );
  network.actor.plexAccountId = BigInt(
    `0x${crypto.randomUUID().replaceAll("-", "")}`,
  ).toString();
  await db.mediaUser.update({
    where: { id: network.actor.id },
    data: { plexAccountId: network.actor.plexAccountId },
  });
  await db.credential.update({
    where: { userId_kind: { userId: network.actor.id, kind: "plex" } },
    data: {
      ciphertext: network.context.cipher.encrypt(
        JSON.stringify({ token: "synthetic-fixture-token" }),
        `plex:${network.actor.plexAccountId}`,
      ),
    },
  });
  const roots = file.context.roots.movies;
  const tv = {
    library: path.join(file.directory, "tv"),
    downloads: roots.downloads,
    control: path.join(file.directory, "tv-control"),
  };
  await mkdir(tv.library);
  await mkdir(tv.control);
  file.context.roots.tv = tv;
  const target = path.join(roots.library, "Film.mkv");
  const bytes = "Synthetic immutable media";
  await writeFile(target, bytes);
  const resolved = importResolvedProfiles(snapshot)[0]?.profiles[0];
  if (resolved === undefined) throw new Error("Resolved fixture missing");
  resolved.profile.formatItems = [];
  const rules = { ...QualityRulesSchema.parse(file.profile.rules), resolved };
  await db.qualityProfile.update({
    where: { id: file.profile.id },
    data: { rules },
  });
  await db.qualityProfileVersion.create({
    data: { profileId: file.profile.id, version: 0, rules },
  });
  const oldBundle = await db.migrationBundle.findUniqueOrThrow({
    where: { id: network.review.bundleId },
  });
  const manifest = MigrationBundleSchema.parse(oldBundle.manifest);
  manifest.bundleHash = snapshotHash({
    original: manifest.bundleHash,
    directory: file.directory,
  });
  for (const mapping of manifest.rootMappings)
    mapping.canonicalRoot =
      mapping.sourceRoot === "/movies" ? roots.library : tv.library;
  const report = BundleReportSchema.parse(network.review.report);
  const mediaEntry = report.entries[0];
  const capture = manifest.captures[0];
  if (capture === undefined || mediaEntry?.sourceRecord.kind !== "media")
    throw new Error("Media report fixture missing");
  mediaEntry.sourceRecord.profileSourceId = String(resolved.profile.id);
  const sourceRecord = {
    kind: "file" as const,
    sourceId: "file1",
    mediaSourceIds: ["1"],
    path: "/movies/Film.mkv",
    sizeBytes: Buffer.byteLength(bytes),
    checksum: null,
    downloadHash: null,
    qualitySourceId: "3",
  };
  const fileEntry = {
    ...mediaEntry,
    sourceRecord,
    sourceId: "file1",
    kind: "file" as const,
    provenanceKey: snapshotHash({ file: target }),
    observationHash: snapshotHash(sourceRecord),
  };
  report.entries.push(fileEntry);
  const requestRecord = {
    kind: "request" as const,
    sourceId: "request1",
    requesterSourceId: "requester1",
    plexAccountId: network.actor.plexAccountId,
    requesterMappingEvidenceHash: snapshotHash(network.actor.id),
    externalIds: { tmdb: z.number().parse(network.media.tmdbId) },
    scope: "movie" as const,
    seasons: [],
    active: true,
  };
  const requestEntry = {
    ...mediaEntry,
    sourceRecord: requestRecord,
    sourceId: requestRecord.sourceId,
    kind: requestRecord.kind,
    provenanceKey: snapshotHash({ request: network.media.id }),
    observationHash: snapshotHash(requestRecord),
  };
  report.entries.push(requestEntry);
  await options.extendReport?.({ report, manifest, target });
  report.bundleHash = manifest.bundleHash;
  report.reportHash = snapshotHash({
    source: report.reportHash,
    file: fileEntry,
    request: requestEntry,
  });
  const bundle = await db.migrationBundle.create({
    data: { bundleHash: manifest.bundleHash, manifest },
  });
  const review = await db.migrationBundleReview.create({
    data: {
      bundleId: bundle.id,
      actorId: network.actor.id,
      reportHash: report.reportHash,
      report,
      selection: [
        {
          provenanceKey: mediaEntry.provenanceKey,
          evidenceHash: mediaEntry.observationHash,
        },
      ],
      recoveryEpoch: 0,
      runtimeVersion: 0,
      status: "approved",
      approvedAt: new Date(),
    },
  });
  const request = PrepareHandoffSchema.parse({
    bundleReviewId: review.id,
    bundleReviewVersion: 0,
    bundleHash: manifest.bundleHash,
    reportHash: report.reportHash,
    recoveryEpoch: 0,
    runtimeVersion: 0,
    purpose: "recovery",
    activation: "activate",
    subtitlePolicies: report.entries
      .filter((entry) => entry.kind === "subtitle_preference")
      .map((entry) => ({
        provenanceKey: entry.provenanceKey,
        expectedPolicyVersion: -1,
        chinese: options.subtitlePolicyResolution ?? "unresolved",
      })),
    selected: [
      ...report.entries
        .filter(
          (entry) =>
            entry.kind === "subtitle" ||
            entry.kind === "torrent" ||
            entry.kind === "subtitle_preference",
        )
        .map((entry) => ({
          provenanceKey: entry.provenanceKey,
          evidenceHash: entry.observationHash,
        })),
      {
        provenanceKey: fileEntry.provenanceKey,
        evidenceHash: fileEntry.observationHash,
      },
      {
        provenanceKey: requestEntry.provenanceKey,
        evidenceHash: requestEntry.observationHash,
      },
    ],
    profiles: [
      {
        captureId: capture.captureId,
        sourceProfileId: String(resolved.profile.id),
        profileId: file.profile.id,
        version: 0,
        snapshotHash: resolved.snapshotHash,
      },
    ],
  });
  const commands = new PrismaMediaHandoff(db);
  const result = await commands.prepare(
    network.actor,
    crypto.randomUUID(),
    request,
  );
  const planId = z.uuid().parse(result.handoffId);
  network.quiescence.targetsDigest = snapshotHash(
    LEGACY_OBSERVER_CONFIG.legacyDeployments,
  );
  const plexItem = {
    ratingKey: "fixture",
    title: network.media.title,
    type: "movie",
    Guid: [{ id: `tmdb://${String(network.media.tmdbId)}` }],
    Media: [
      { Part: [{ id: 1, file: target, size: Buffer.byteLength(bytes) }] },
    ],
  };
  network.context.plex.libraryPage = () =>
    Promise.resolve({ total: 1, items: [plexItem] });
  network.context.plex.metadata = () => Promise.resolve(plexItem);
  const observe = async () => {
    const quiescence = await network.context.observer.observe();
    const mounts = await network.context.observer.observeMountBindings([
      {
        sourceDeployment: "media-radarr",
        sourceContainer: "container-0",
        sourceRoot: "/movies",
        canonicalDeployment: "media-media-files",
        canonicalContainer: "media-files",
        canonicalRoot: roots.library,
      },
      {
        sourceDeployment: "media-sonarr",
        sourceContainer: "container-0",
        sourceRoot: "/tv",
        canonicalDeployment: "media-media-files",
        canonicalContainer: "media-files",
        canonicalRoot: tv.library,
      },
    ]);
    const evidence = HandoffNetworkEvidenceSchema.parse({
      schemaVersion: 1,
      planId,
      recoveryEpoch: 0,
      quiescence,
      mounts,
      capturedAt: new Date().toISOString(),
      expiresAt: quiescence.expiresAt,
      claims: await observeClaims(
        network.context,
        await readHandoffPlan(db, planId),
        new AbortController().signal,
      ),
      plex: [
        {
          mediaId: network.media.id,
          ratingKey: "fixture",
          sectionId: "1",
          canonicalPath: target,
          identityHash: snapshotHash(plexItem),
        },
      ],
      torrents: [],
    });
    return db.mediaHandoffObservation.create({
      data: {
        planId,
        kind: "network",
        evidence,
        evidenceHash: snapshotHash(z.json().parse(evidence)),
        observedAt: new Date(),
        expiresAt: new Date(evidence.expiresAt),
      },
    });
  };
  const context = { files: file.context, workerPodUid: "files-pod-uid" };
  async function ready(approver?: MediaActor) {
    await observe();
    const proof = await prepareHandoffFiles(context, planId);
    await finishHandoffPreparation(db, planId, proof);
    const detail = await commands.detail(network.actor, planId);
    const applied = await commands.apply(
      approver ?? network.actor,
      crypto.randomUUID(),
      planId,
      {
        expectedVersion: detail.version,
        planHash: z.string().parse(detail.planHash),
        recoveryEpoch: 0,
        runtimeVersion: 0,
        acknowledgeProtectedLegacySources: true,
        acknowledgeRecoveryHolds: true,
      },
    );
    await observe();
    return {
      input: { planId, operationId: z.uuid().parse(applied.operationId) },
      prepared: await prepareHandoffFiles(context, planId),
    };
  }
  return {
    ...file,
    network,
    context,
    commands,
    planId,
    target,
    bytes,
    ready,
    observe,
    request,
  };
}
