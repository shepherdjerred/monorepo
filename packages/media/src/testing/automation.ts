import { randomBytes } from "node:crypto";
import { afterAll, beforeAll } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { CredentialCipher } from "#application/security.ts";
import { PlexClient } from "#integrations/plex.ts";
import { TmdbClient } from "#integrations/tmdb.ts";
import { QbittorrentClient } from "#integrations/qbittorrent.ts";
import { type FetchTransport } from "#integrations/http.ts";
import { queueOperation, serializable } from "#automation/store.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import { grantTestLease } from "#testing/authority.ts";
import { chooseTestMovieEdition } from "#infrastructure/movie-editions/test-support.ts";
import type { Database } from "#infrastructure/database.ts";
import { lockDefaultScopes } from "#infrastructure/editions/locks.ts";
import { targetWhere } from "#infrastructure/editions/targets.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { testWatchExecution } from "./watch-execution.ts";

export async function ensureTestProvider(db: Database) {
  await db.mediaProvider.createMany({
    data: [{ id: "knaben", enabled: true, seedingPolicy: { kind: "public" } }],
    skipDuplicates: true,
  });
}

export function automationTestHarness() {
  let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
  const cipher = new CredentialCipher(randomBytes(32).toString("base64"));
  beforeAll(async () => {
    cluster = await startMediaTestPostgres();
  }, 60_000);
  afterAll(async () => {
    await cluster.close();
  });

  function context(
    transport: FetchTransport = () =>
      Promise.reject(new Error("Unexpected network call")),
  ): MediaAutomationContext {
    const plexConfig = {
      baseUrl: "http://plex.fixture",
      token: "fixture",
      clientIdentifier: "media-fixture",
    };
    return {
      db: cluster.database,
      watchExecution: testWatchExecution,
      serverMachineId: "fixture-server",
      tmdb: new TmdbClient({ kind: "api-key", apiKey: "fixture" }, transport),
      cipher,
      providers: {
        withProvider: () =>
          Promise.reject(new Error("Unexpected tracker call")),
      },
      plex: new PlexClient(plexConfig, transport),
      userPlex: (token) => new PlexClient({ ...plexConfig, token }, transport),
      qbittorrent: new QbittorrentClient(
        {
          baseUrl: "http://qbit.fixture",
          username: "fixture",
          password: "fixture",
          category: "media",
        },
        transport,
      ),
      gates: {
        acquisition: () => Promise.resolve(true),
        sourceCleanup: () => Promise.resolve(true),
        quarantine: () => Promise.resolve(true),
        purge: () => Promise.resolve(true),
      },
      publicOrigin: "https://media.fixture",
      downloadRoot: "/downloads",
      startWorkflow: () =>
        Promise.reject(new Error("Unexpected workflow start")),
      describeWorkflow: () =>
        Promise.reject(new Error("Unexpected workflow description")),
      permittedSections: () => Promise.resolve({ movie: "1", series: "2" }),
      refreshExclusionProofs: () => Promise.resolve(),
      refreshWriterLease: () => grantTestLease(cluster.database),
      notify: () => Promise.reject(new Error("Unexpected notification")),
    };
  }

  async function fixture(
    ratingKey = "123",
    options: { chooseMovieEdition?: boolean; kind?: "movie" | "episode" } = {},
  ) {
    const db = cluster.database;
    await grantTestLease(db);
    await db.mediaRuntimeState.update({
      where: { id: "singleton" },
      data: { mode: "active", ownershipConfirmed: true, recoveryEpoch: 0 },
    });
    const user = await db.mediaUser.create({
      data: { plexAccountId: crypto.randomUUID(), displayName: "Requester" },
    });
    await db.plexIdentityMapping.create({
      data: {
        userId: user.id,
        serverMachineId: "fixture-server",
        serverAccountId: user.plexAccountId,
        kind: "account",
        permittedSectionIds: ["1", "2"],
        permittedMediaKinds: ["movie", "series"],
        verifiedAt: new Date(),
      },
    });
    const series =
      options.kind === "episode"
        ? await db.mediaItem.create({
            data: { kind: "series", title: "Example series" },
          })
        : null;
    const media = await db.mediaItem.create({
      data: {
        kind: options.kind ?? "movie",
        ...(series === null
          ? {}
          : { parentId: series.id, seasonNumber: 1, episodeNumber: 1 }),
        title: "Example",
        year: 2020,
        externalIds: {
          plexRatingKey: ratingKey,
          plexSectionId: series === null ? "1" : "2",
        },
      },
    });
    const rules = {
      qualities: ["WEB-1080p"],
      rejectedCodecs: [],
      requiredAudioLanguages: [],
      minimumBytes: 1,
      maximumBytes: 10_000_000,
      minimumScore: 0,
      tagScores: {},
      cutoffQuality: "WEB-1080p",
      cutoffScore: 0,
    };
    const profile = await db.qualityProfile.create({
      data: {
        name: "Fixture",
        rules,
        versions: { create: { version: 0, rules } },
      },
    });
    await db.$transaction(async (tx) => {
      await lockDefaultScopes(tx, [defaultScope(media.id)], {
        createMissing: true,
      });
      await tx.mediaIntent.update({
        where: targetWhere(defaultScope(media.id)),
        data: {
          generation:
            media.kind !== "movie" || options.chooseMovieEdition === false
              ? 1
              : 0,
          profileId: profile.id,
          automationEpoch: 0,
          desiredPresence: true,
          monitoring: true,
        },
      });
    });
    await db.mediaRequest.create({
      data: { userId: user.id, mediaId: media.id },
    });
    if (media.kind === "movie" && options.chooseMovieEdition !== false)
      await chooseTestMovieEdition(db, {
        actor: { ...user, role: "member" },
        mediaId: media.id,
        access: { serverMachineId: "fixture-server", movieSectionId: "1" },
      });
    const currentTarget = await db.mediaIntent.findUniqueOrThrow({
      where: targetWhere(defaultScope(media.id)),
    });
    const source = {
      providerId: "knaben",
      providerReleaseId: crypto.randomUUID(),
      title: "Example.2020.WEB-1080p",
      sizeBytes: 1000,
      seeders: 2,
      infoHash: randomBytes(20).toString("hex"),
      detailsUrl: "https://provider.fixture/details",
      download: { kind: "magnet", value: "" },
    };
    source.download.value = `magnet:?xt=urn:btih:${source.infoHash}`;
    await ensureTestProvider(db);
    const release = await db.releaseCandidate.create({
      data: {
        providerId: source.providerId,
        providerReleaseId: source.providerReleaseId,
        title: source.title,
        mediaIds: [media.id],
        attributes: {
          mediaIds: [media.id],
          identityConfidence: "exact",
          quality: "WEB-1080p",
          codec: "h264",
          audioLanguages: [],
          sizeBytes: 1000,
          scoreTags: [],
        },
        evaluation: { accepted: true, qualityRank: 0, score: 0, reasons: [] },
        encryptedSource: cipher.encrypt(
          JSON.stringify(source),
          `release:${source.providerId}:${source.providerReleaseId}`,
        ),
      },
    });
    const operationId = await serializable(db, async (tx) =>
      queueOperation(tx, {
        key: crypto.randomUUID(),
        kind: "acquire_release",
        targetId: media.id,
        payload: {
          mediaId: media.id,
          generation: currentTarget.generation,
          releaseId: release.id,
        },
      }),
    );
    return {
      user,
      profile,
      media,
      series,
      release,
      source,
      input: {
        operationId,
        mediaId: media.id,
        generation: currentTarget.generation,
      },
    };
  }

  return { database: () => cluster.database, cipher, context, fixture };
}
