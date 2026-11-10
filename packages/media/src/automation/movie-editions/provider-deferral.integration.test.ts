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
    const acquired = await movie.reconcileMovieIntentV4(
      f.input,
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
