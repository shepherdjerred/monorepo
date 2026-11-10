import { beforeAll, expect, test } from "vitest";
import { createMovieWorkflowFixture } from "#testing/movie-workflow/fixture.ts";
import { movieVideoFixture } from "#testing/movie-video.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import {
  DatabaseProviderRegistry,
  ProviderAdmissionDeferred,
} from "#automation/providers.ts";
import { createMovieNetworkFacetV4 } from "./activities.ts";
import { IntegrationError } from "#integrations/http.ts";
import type { MovieProviderSearchProgressV4 } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import { QualityRulesSchema } from "#shared/api.ts";

let bytes: Uint8Array;
beforeAll(async () => {
  bytes = await movieVideoFixture();
});

test("a movie's same operation waits through real foreign admission and cooldown, then submits exactly once", async () => {
  const f = await createMovieWorkflowFixture("default", { bytes });
  const { db, context } = f.source;
  try {
    const sources = await context.providers.withProvider("knaben", (client) =>
      client.search({ query: "Workflow Fixture", kind: "movie", page: 1 }),
    );
    const source = sources[0];
    if (source === undefined)
      throw new Error("Fixture omitted its actual source");
    let calls = 0;
    const providers = new DatabaseProviderRegistry(db, context.cipher, () => {
      calls++;
      return Promise.resolve(
        Response.json({
          hits: [
            {
              id: source.providerReleaseId,
              title: source.title,
              bytes: source.sizeBytes,
              hash: source.infoHash,
              seeders: source.seeders,
              details: source.detailsUrl,
              magnetUrl: null,
            },
          ],
        }),
      );
    });
    const movie = createMovieNetworkFacetV4({ ...context, providers });
    const held = await db.providerLease.create({
      data: {
        providerId: "knaben",
        ownerId: "other-search",
        leaseUntil: new Date(Date.now() + 90_000),
        nextAllowedAt: new Date(Date.now() - 1),
      },
    });
    const busy = await movie.reconcileMovieIntentV4(
      f.input,
      testPlexBindingExecution(),
    );
    if (!("retryAfterSeconds" in busy))
      throw new Error("Local admission omitted its retry delay");
    expect(busy).toMatchObject({
      status: "waiting",
      attemptId: null,
      reason: "provider_deferred",
    });
    expect(busy.retryAfterSeconds).toBeGreaterThan(0);
    expect(busy.retryAfterSeconds).toBeLessThanOrEqual(30);
    expect(
      await db.providerLease.findUniqueOrThrow({
        where: { providerId: "knaben" },
      }),
    ).toEqual(held);
    const eligibleAt = new Date(Date.now() + 45_000);
    await db.providerLease.update({
      where: { providerId: "knaben" },
      data: { ownerId: null, leaseUntil: null, nextAllowedAt: eligibleAt },
    });
    const cooling = await movie.reconcileMovieIntentV4(
      f.input,
      testPlexBindingExecution(),
    );
    if (!("retryAfterSeconds" in cooling))
      throw new Error("Local cooldown omitted its retry delay");
    expect(cooling).toMatchObject({
      status: "waiting",
      attemptId: null,
      reason: "provider_deferred",
    });
    expect(cooling.retryAfterSeconds).toBeGreaterThanOrEqual(44);
    expect(cooling.retryAfterSeconds).toBeLessThanOrEqual(45);
    expect(calls).toBe(0);
    expect(await db.acquisitionAttempt.count()).toBe(0);
    expect(f.source.wire.additions()).toBe(0);
    // Advance only the synthetic lease's eligibility; production admission is unchanged.
    await db.providerLease.update({
      where: { providerId: "knaben" },
      data: { nextAllowedAt: new Date(Date.now() - 1) },
    });
    if (
      !("providerSearchProgress" in cooling) ||
      !cooling.providerSearchProgress
    )
      throw new Error("Cooldown omitted its scoped search progress");
    const acquired = await movie.reconcileMovieIntentV4(
      { ...f.input, providerSearchProgress: cooling.providerSearchProgress },
      testPlexBindingExecution(),
    );
    expect(acquired.status).toBe("acquire");
    if (acquired.attemptId === null)
      throw new Error("Eligible movie omitted its actual attempt");
    expect(
      await movie.reconcileMovieIntentV4(f.input, testPlexBindingExecution()),
    ).toMatchObject({ attemptId: acquired.attemptId });
    expect(calls).toBe(1);
    expect(await db.acquisitionAttempt.count()).toBe(1);
    expect(
      await f.movie.submitMovieTorrentV4(
        {
          schemaVersion: 4,
          operationId: f.input.operationId,
          attemptId: acquired.attemptId,
          scope: f.input.scope,
        },
        testPlexBindingExecution(),
      ),
    ).toEqual({ status: "submitted", reason: null });
    expect(f.source.wire.additions()).toBe(1);
  } finally {
    await f.close();
  }
});

test("empty search and remote provider failures cannot manufacture local-admission retries", async () => {
  const f = await createMovieWorkflowFixture("default", { bytes });
  try {
    for (const error of [
      null,
      new IntegrationError("knaben", "authentication", 401),
      new IntegrationError("knaben", "interaction-required"),
      new IntegrationError("knaben", "rate-limited", 429, 3600),
      new IntegrationError("knaben", "unavailable", 503),
    ]) {
      const movie = createMovieNetworkFacetV4({
        ...f.source.context,
        providers: {
          withProvider: (_id, work) =>
            error === null
              ? work({ search: () => Promise.resolve([]) })
              : Promise.reject(error),
        },
      });
      expect(
        await movie.reconcileMovieIntentV4(f.input, testPlexBindingExecution()),
      ).toEqual({
        status: "waiting",
        attemptId: null,
        reason: "no_acceptable_release",
      });
    }
    expect(await f.source.db.acquisitionAttempt.count()).toBe(0);
    expect(f.source.wire.additions()).toBe(0);
  } finally {
    await f.close();
  }
});

test("an admitted alternative can satisfy a movie while another provider is locally deferred", async () => {
  const f = await createMovieWorkflowFixture("default", { bytes });
  try {
    await f.source.db.mediaProvider.create({
      data: {
        id: "thepiratebay",
        enabled: true,
        seedingPolicy: { kind: "public" },
      },
    });
    const seen: string[] = [];
    const movie = createMovieNetworkFacetV4({
      ...f.source.context,
      providers: {
        withProvider: (id, work) => {
          seen.push(id);
          if (id === "knaben")
            return Promise.reject(
              new ProviderAdmissionDeferred(
                id,
                new Date(Date.now() + 30_000),
                "lease_busy",
              ),
            );
          return f.source.context.providers.withProvider("knaben", (client) =>
            work({
              search: async (input) => {
                const sources = await client.search(input);
                return sources.map((source) => ({
                  ...source,
                  providerId: "thepiratebay" as const,
                }));
              },
            }),
          );
        },
      },
    });
    expect(
      await movie.reconcileMovieIntentV4(f.input, testPlexBindingExecution()),
    ).toMatchObject({ status: "acquire", reason: null });
    expect(seen).toEqual(["knaben", "thepiratebay"]);
    expect(await f.source.db.acquisitionAttempt.count()).toBe(1);
  } finally {
    await f.close();
  }
});

async function staggeredEmptySearch(remoteStatus?: number) {
  const f = await createMovieWorkflowFixture("default", { bytes });
  const { db, context } = f.source;
  await db.mediaProvider.create({
    data: {
      id: "thepiratebay",
      enabled: true,
      seedingPolicy: { kind: "public" },
    },
  });
  const calls: string[] = [];
  const providers = new DatabaseProviderRegistry(db, context.cipher, (url) => {
    const pirate = url.hostname === "apibay.org";
    calls.push(pirate ? "thepiratebay" : "knaben");
    return Promise.resolve(
      Response.json(
        pirate ? [] : { hits: [] },
        !pirate && remoteStatus !== undefined ? { status: remoteStatus } : {},
      ),
    );
  });
  const movie = createMovieNetworkFacetV4({ ...context, providers });
  const foreign = await db.providerLease.create({
    data: {
      providerId: "thepiratebay",
      ownerId: "other-search",
      leaseUntil: new Date(Date.now() + 90_000),
      nextAllowedAt: new Date(Date.now() - 1),
    },
  });
  const first = await movie.reconcileMovieIntentV4(
    f.input,
    testPlexBindingExecution(),
  );
  if (!("providerSearchProgress" in first) || !first.providerSearchProgress)
    throw new Error("Deferred search omitted completed-provider progress");
  return { f, movie, calls, foreign, progress: first.providerSearchProgress };
}

test("two staggered admitted empty providers finish without reclaiming the first provider's cooldown", async () => {
  const { f, movie, calls, foreign, progress } = await staggeredEmptySearch();
  const { db } = f.source;
  try {
    expect(progress.completedProviderIds).toEqual(["knaben"]);
    expect(calls).toEqual(["knaben"]);
    expect(
      await db.providerLease.findUniqueOrThrow({
        where: { providerId: "thepiratebay" },
      }),
    ).toEqual(foreign);
    const cooling = await db.providerLease.findUniqueOrThrow({
      where: { providerId: "knaben" },
    });
    expect(cooling.nextAllowedAt.getTime()).toBeGreaterThan(Date.now());
    await db.providerLease.update({
      where: { providerId: "thepiratebay" },
      data: {
        ownerId: null,
        leaseUntil: null,
        nextAllowedAt: new Date(Date.now() - 1),
      },
    });
    expect(
      await movie.reconcileMovieIntentV4(
        { ...f.input, providerSearchProgress: progress },
        testPlexBindingExecution(),
      ),
    ).toEqual({
      status: "waiting",
      attemptId: null,
      reason: "no_acceptable_release",
    });
    expect(calls).toEqual(["knaben", "thepiratebay"]);
    expect(
      await db.providerLease.findUniqueOrThrow({
        where: { providerId: "knaben" },
      }),
    ).toEqual(cooling);
    expect(await db.acquisitionAttempt.count()).toBe(0);
    expect(f.source.wire.additions()).toBe(0);
  } finally {
    await f.close();
  }
});

test.each([401, 429, 503])(
  "a remote HTTP%s settles once while another provider waits locally",
  async (remoteStatus) => {
    const { f, movie, calls, progress } =
      await staggeredEmptySearch(remoteStatus);
    const { db } = f.source;
    try {
      expect(progress.completedProviderIds).toEqual(["knaben"]);
      const failed = await db.mediaProvider.findUniqueOrThrow({
        where: { id: "knaben" },
      });
      expect(failed.lastError).toBe(
        remoteStatus === 401
          ? "authentication"
          : remoteStatus === 429
            ? "rate-limited"
            : "unavailable",
      );
      await db.providerLease.update({
        where: { providerId: "thepiratebay" },
        data: {
          ownerId: null,
          leaseUntil: null,
          nextAllowedAt: new Date(Date.now() - 1),
        },
      });
      expect(
        await movie.reconcileMovieIntentV4(
          { ...f.input, providerSearchProgress: progress },
          testPlexBindingExecution(),
        ),
      ).toEqual({
        status: "waiting",
        attemptId: null,
        reason: "no_acceptable_release",
      });
      expect(calls).toEqual(["knaben", "thepiratebay"]);
      expect(
        await db.mediaProvider.findUniqueOrThrow({
          where: { id: "knaben" },
        }),
      ).toEqual(failed);
      expect(await db.acquisitionAttempt.count()).toBe(0);
    } finally {
      await f.close();
    }
  },
);

test.each(["query", "profile", "provider_configuration"] as const)(
  "completed-provider progress resets when current %s criteria change",
  async (changed) => {
    const { f, movie, calls, progress } = await staggeredEmptySearch();
    const { db, media, profile } = f.source;
    try {
      if (changed === "query")
        await db.mediaItem.update({
          where: { id: media.id },
          data: { title: "Workflow Fixture Revised" },
        });
      else if (changed === "profile") {
        await db.qualityProfileVersion.create({
          data: {
            profileId: profile.id,
            version: 1,
            rules: QualityRulesSchema.parse(profile.rules),
          },
        });
        await db.qualityProfile.update({
          where: { id: profile.id },
          data: { version: 1 },
        });
      } else
        await db.mediaProvider.update({
          where: { id: "knaben" },
          data: { configuration: { minimumIntervalSeconds: 31 } },
        });
      // Only synthetic eligibility changes; the registry must actually search
      // the changed criteria rather than trusting the old completed ID.
      await db.providerLease.update({
        where: { providerId: "knaben" },
        data: { nextAllowedAt: new Date(Date.now() - 1) },
      });
      const next = await movie.reconcileMovieIntentV4(
        { ...f.input, providerSearchProgress: progress },
        testPlexBindingExecution(),
      );
      if (!("providerSearchProgress" in next) || !next.providerSearchProgress)
        throw new Error("Changed search omitted its own progress");
      expect(next).toMatchObject({
        status: "waiting",
        reason: "provider_deferred",
      });
      expect(next.providerSearchProgress.criteriaDigest).not.toBe(
        progress.criteriaDigest,
      );
      expect(calls).toEqual(["knaben", "knaben"]);
      expect(await db.acquisitionAttempt.count()).toBe(0);
    } finally {
      await f.close();
    }
  },
);

test("another operation and edition cannot reuse completed-provider progress", async () => {
  const first = await staggeredEmptySearch();
  let other: Awaited<ReturnType<typeof createMovieWorkflowFixture>> | undefined;
  try {
    other = await createMovieWorkflowFixture("extended_cut", { bytes });
    let calls = 0;
    const movie = createMovieNetworkFacetV4({
      ...other.source.context,
      providers: {
        withProvider: (_id, work) => {
          calls++;
          return work({ search: () => Promise.resolve([]) });
        },
      },
    });
    const progress: MovieProviderSearchProgressV4 = first.progress;
    expect(
      await movie.reconcileMovieIntentV4(
        { ...other.input, providerSearchProgress: progress },
        testPlexBindingExecution(),
      ),
    ).toEqual({
      status: "waiting",
      attemptId: null,
      reason: "no_acceptable_release",
    });
    expect(calls).toBe(1);
    expect(await other.source.db.acquisitionAttempt.count()).toBe(0);
  } finally {
    await other?.close();
    await first.f.close();
  }
});

test.each(["intent", "authority"] as const)(
  "continued discovery still rereads current %s before trusting bookkeeping",
  async (changed) => {
    const { f, movie, calls, progress } = await staggeredEmptySearch();
    try {
      if (changed === "intent")
        await f.source.db.mediaIntent.update({
          where: {
            mediaId_edition: {
              mediaId: f.input.mediaId,
              edition: f.input.scope.edition,
            },
          },
          data: { desiredPresence: false },
        });
      else
        await f.source.db.mediaRuntimeState.update({
          where: { id: "singleton" },
          data: { mode: "observe", ownershipConfirmed: false },
        });
      expect(
        await movie.reconcileMovieIntentV4(
          { ...f.input, providerSearchProgress: progress },
          testPlexBindingExecution(),
        ),
      ).toMatchObject({
        status: changed === "intent" ? "obsolete" : "blocked",
        reason:
          changed === "intent" ? "intent_changed" : "acquisition_disabled",
      });
      expect(calls).toEqual(["knaben"]);
      expect(await f.source.db.acquisitionAttempt.count()).toBe(0);
    } finally {
      await f.close();
    }
  },
);
