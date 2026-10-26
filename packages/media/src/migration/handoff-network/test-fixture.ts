import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import type { CredentialCipher } from "#application/security.ts";
import { HandoffScopeSchema } from "#shared/handoff.ts";
import {
  QuiescenceEvidenceSchema,
  MountEvidenceSchema,
} from "#shared/legacy-observer.ts";
import { LEGACY_OBSERVER_CONFIG } from "#integrations/legacy-observer/config.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import type { HandoffNetworkContext } from "./context.ts";

const hash = (value: string) => snapshotHash(value);
export async function networkFixture(
  db: Database,
  cipher: CredentialCipher,
  serverMachineId = "server",
) {
  await db.mediaRuntimeState.update({
    where: { id: "singleton" },
    data: {
      mode: "observe",
      ownershipConfirmed: false,
      recoveryEpoch: 0,
      version: 0,
    },
  });
  const actor = await db.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "Fixture",
      role: "owner",
      plexIdentity: {
        create: {
          kind: "account",
          serverMachineId,
          permittedSectionIds: ["1", "2"],
          permittedMediaKinds: ["movie", "series"],
        },
      },
    },
  });
  await db.credential.create({
    data: {
      userId: actor.id,
      kind: "plex",
      ciphertext: cipher.encrypt(
        JSON.stringify({ token: "synthetic-fixture-token" }),
        `plex:${actor.plexAccountId}`,
      ),
    },
  });
  const media = await db.mediaItem.create({
    data: {
      kind: "movie",
      title: "Synthetic Film",
      tmdbId: Math.floor(Math.random() * 1_000_000_000),
      externalIds: {},
    },
  });
  const captureIds = [crypto.randomUUID(), crypto.randomUUID()];
  await db.$transaction(async (tx) => {
    await lockDefaultScopes(tx, [defaultScope(media.id)], {
      createMissing: true,
    });
  });
  const captures = ["radarr", "sonarr"].map((sourceKind, index) => ({
    sourceKind,
    captureId: captureIds[index],
    captureHash: hash(`${media.id}:${sourceKind}`),
    sourceInstanceId: hash(sourceKind),
  }));
  const rootMappings = captures.map((capture) => ({
    captureId: capture.captureId,
    sourceRoot: capture.sourceKind === "radarr" ? "/movies" : "/tv",
    canonicalRoot:
      capture.sourceKind === "radarr" ? "/data/movies" : "/data/tv",
    sourceMountIdentity: hash(capture.sourceKind),
    verified: false,
  }));
  const manifest = {
    schemaVersion: 1,
    bundleHash: hash(media.id),
    captures,
    rootMappings,
    requiredSources: ["radarr", "sonarr"],
    associations: [],
    complete: true,
    stable: true,
  };
  const selected = [
    {
      provenanceKey: hash(`file:${media.id}`),
      evidenceHash: hash(`record:${media.id}`),
    },
  ];
  const report = {
    schemaVersion: 1,
    bundleHash: manifest.bundleHash,
    reportHash: hash(`report:${media.id}`),
    complete: true,
    stable: true,
    mayTransferOwnership: false,
    entries: [
      {
        sourceRecord: {
          kind: "media",
          sourceId: "1",
          mediaKind: "movie",
          externalIds: { tmdb: media.tmdbId },
          parentSourceId: null,
          season: null,
          episode: null,
          profileSourceId: null,
          monitored: true,
        },
        sourceId: "1",
        kind: "media",
        observationHash: selected[0]?.evidenceHash,
        provenanceKey: selected[0]?.provenanceKey,
        captureHash: captures[0]?.captureHash,
        mappedMedia: [{ mediaId: media.id, title: media.title }],
        mediaIds: [media.id],
        confidence: "exact",
        state: "protected_exact",
        reasons: [],
        owned: false,
      },
    ],
  };
  const bundle = await db.migrationBundle.create({
    data: { bundleHash: manifest.bundleHash, manifest: json(manifest) },
  });
  const review = await db.migrationBundleReview.create({
    data: {
      bundleId: bundle.id,
      actorId: actor.id,
      reportHash: report.reportHash,
      report: json(report),
      selection: selected,
      recoveryEpoch: 0,
      runtimeVersion: 0,
      status: "approved",
      approvedAt: new Date(),
    },
  });
  const scope = HandoffScopeSchema.parse({
    request: {
      bundleReviewId: review.id,
      bundleReviewVersion: 0,
      bundleHash: manifest.bundleHash,
      reportHash: report.reportHash,
      recoveryEpoch: 0,
      runtimeVersion: 0,
      purpose: "migration",
      activation: "activate",
      selected,
      profiles: [],
    },
    media: [
      {
        mediaId: media.id,
        version: 0,
        generation: 0,
        profileId: null,
        profileVersion: null,
        monitored: true,
      },
    ],
    claims: [
      {
        provenanceKey: selected[0]?.provenanceKey,
        userId: actor.id,
        mediaId: media.id,
        includeFutureEpisodes: false,
        subtitleLanguages: [],
      },
    ],
    files: [
      {
        provenanceKey: selected[0]?.provenanceKey,
        captureId: captures[0]?.captureId,
        mediaIds: [media.id],
        sourcePath: "/movies/Film.mkv",
        canonicalPath: "/data/movies/Film.mkv",
        libraryKind: "movies",
        sizeBytes: "100",
        capturedChecksum: null,
        qualitySourceId: null,
        existingAssetId: null,
        existingAssetVersion: null,
        assetId: crypto.randomUUID(),
      },
    ],
    protected: [],
  });
  const plan = await db.mediaHandoffPlan.create({
    data: {
      bundleReviewId: review.id,
      actorId: actor.id,
      recoveryEpoch: 0,
      runtimeVersion: 0,
      bundleReviewVersion: 0,
      requestHash: snapshotHash(scope.request),
      scope,
    },
  });
  const now = new Date().toISOString();
  const expiry = new Date(Date.now() + 90_000).toISOString();
  const quiescence = QuiescenceEvidenceSchema.parse({
    schemaVersion: 1,
    namespace: "media",
    capturedAt: now,
    expiresAt: expiry,
    targetsDigest: hash("targets"),
    configurationDigest: snapshotHash(LEGACY_OBSERVER_CONFIG),
    inventoryDigest: hash("inventory"),
    controllers: LEGACY_OBSERVER_CONFIG.legacyDeployments.map((name) => ({
      kind: "Deployment",
      name,
      uid: `${name}-uid`,
      generation: 1,
      resourceVersion: "1",
      specDigest: hash(name),
      observedGeneration: 1,
      desired: 0,
      current: 0,
      ready: 0,
    })),
    blockers: [],
    quiescent: true,
  });
  const context: HandoffNetworkContext = {
    db,
    cipher,
    expectedServerMachineId: serverMachineId,
    permittedSections: () => Promise.resolve({ movie: "1", series: "2" }),
    authentication: {
      resolveServerAccess: () =>
        Promise.resolve({
          accountId: actor.plexAccountId,
          serverMachineId,
          serverToken: "synthetic",
          permittedSectionIds: ["1", "2"],
          permittedMediaKinds: ["movie", "series"],
          plexRestricted: false,
        }),
    },
    plex: {
      machineIdentifier: () => Promise.resolve(serverMachineId),
      sections: () =>
        Promise.resolve([{ key: "1", title: "Movies", type: "movie" }]),
      libraryPage: () => Promise.resolve({ total: 1, items: [item()] }),
      metadata: () => Promise.resolve(item()),
    },
    qbittorrent: {
      listAll: () => Promise.reject(new Error("No selected torrent")),
    },
    observer: {
      observeCanonicalMounts: () =>
        Promise.reject(
          new Error("Legacy fixture has no native storage observation"),
        ),
      observe: () => Promise.resolve(quiescence),
      observeMountBindings: (requests) =>
        Promise.resolve(
          MountEvidenceSchema.parse({
            schemaVersion: 1,
            namespace: "media",
            capturedAt: now,
            expiresAt: expiry,
            configurationDigest: quiescence.configurationDigest,
            bindings: requests.map((request) => {
              const base = {
                generation: 1,
                readOnly: false,
                subPath: "",
                pvcName: "library",
                pvcUid: `pvc:${request.canonicalRoot}`,
                volumeName: "pv-library",
                volumePath: "",
              };
              return {
                source: {
                  ...base,
                  deployment: request.sourceDeployment,
                  deploymentUid: `${request.sourceDeployment}-uid`,
                  specDigest: hash(request.sourceDeployment),
                  container: request.sourceContainer,
                  root: request.sourceRoot,
                  mountPath: request.sourceRoot,
                },
                canonical: {
                  ...base,
                  deployment: request.canonicalDeployment,
                  deploymentUid: "files",
                  specDigest: hash("files"),
                  container: request.canonicalContainer,
                  root: request.canonicalRoot,
                  mountPath: request.canonicalRoot,
                  podName: "media-files-pod",
                  podUid: "files-pod-uid",
                  podSpecDigest: hash("pod"),
                  replicaSetUid: "files-rs",
                },
                evidenceHash: hash(request.sourceRoot),
              };
            }),
          }),
        ),
    },
  };
  function item() {
    return {
      ratingKey: "fixture",
      title: media.title,
      type: "movie",
      Guid: [{ id: `tmdb://${String(media.tmdbId)}` }],
      Media: [{ Part: [{ id: 1, file: "/data/movies/Film.mkv", size: 100 }] }],
    };
  }
  return { context, plan, actor, media, review, quiescence };
}
function json(value: unknown) {
  return z.record(z.string(), z.json()).parse(value);
}
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { defaultScope } from "#shared/editions/scope.ts";
