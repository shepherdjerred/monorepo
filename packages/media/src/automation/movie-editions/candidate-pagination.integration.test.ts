import { expect, test } from "vitest";
import { DatabaseProviderRegistry } from "#automation/providers.ts";
import { createMovieWorkflowFixture } from "#testing/movie-workflow/fixture.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { createMovieNetworkFacetV4 } from "./activities.ts";

test("later pages compete with all first pages before one durable reservation", async () => {
  const f = await createMovieWorkflowFixture("default");
  const { db, context } = f.source;
  try {
    await db.mediaProvider.create({
      data: {
        id: "thepiratebay",
        enabled: true,
        seedingPolicy: { kind: "public" },
      },
    });
    const [standard] = await context.providers.withProvider(
      "knaben",
      (client) => client.search({ query: "Workflow Fixture", kind: "movie" }),
    );
    if (!standard) throw new Error("Missing fixture listing");
    const winner = {
      ...standard,
      providerReleaseId: "second-page-winner",
      title: standard.title.replace("1080p", "2160p"),
    };
    const calls: string[] = [];
    const movie = createMovieNetworkFacetV4({
      ...context,
      providers: {
        withProvider: (id, work) =>
          work({
            search: ({ page = 1 }) => {
              calls.push(`${id}:${String(page)}`);
              return Promise.resolve([
                { ...standard, providerId: "thepiratebay" },
              ]);
            },
            ...(id === "knaben"
              ? {
                  searchPage: ({ page = 1 }) => {
                    calls.push(`knaben:${String(page)}`);
                    const candidates =
                      page === 1 ? [standard] : [standard, winner];
                    return Promise.resolve({
                      candidates,
                      listingIds: candidates.map(
                        ({ providerReleaseId }) => providerReleaseId,
                      ),
                      nextPage: page === 1 ? 2 : null,
                    });
                  },
                }
              : {}),
          }),
      },
    });
    const first = await movie.reconcileMovieIntentV4(
      f.input,
      testPlexBindingExecution(),
    );
    expect(first).toMatchObject({
      status: "waiting",
      reason: "provider_deferred",
    });
    expect(calls).toEqual(["knaben:1", "thepiratebay:1"]);
    expect(await db.acquisitionAttempt.count()).toBe(0);
    if (
      !("providerSearchProgress" in first) ||
      first.providerSearchProgress === undefined
    )
      throw new Error("Paging checkpoint missing");
    const continuation = {
      ...f.input,
      providerSearchProgress: first.providerSearchProgress,
    };
    const result = await movie.reconcileMovieIntentV4(
      continuation,
      testPlexBindingExecution(),
    );
    expect(result.status).toBe("acquire");
    expect(result.attemptId).not.toBeNull();
    expect(
      await movie.reconcileMovieIntentV4(
        continuation,
        testPlexBindingExecution(),
      ),
    ).toMatchObject({ status: "acquire", attemptId: result.attemptId });
    expect(calls).toEqual(["knaben:1", "thepiratebay:1", "knaben:2"]);
    expect(await db.acquisitionAttempt.count()).toBe(1);
    expect(await db.acquisitionReservation.count()).toBe(1);
    expect(await db.releaseCandidate.count()).toBe(3);
    expect(
      await db.acquisitionAttempt.findFirstOrThrow({
        include: { release: true },
      }),
    ).toMatchObject({
      release: {
        providerId: "knaben",
        providerReleaseId: winner.providerReleaseId,
      },
    });
  } finally {
    await f.close();
  }
});

test("a cold private tracker login preserves the applied local deadline and later searches page one", async () => {
  const f = await createMovieWorkflowFixture("default");
  const { db, context } = f.source;
  try {
    await db.mediaProvider.update({
      where: { id: "knaben" },
      data: { enabled: false },
    });
    const credential = await db.credential.create({
      data: {
        kind: "provider:privatehd",
        ciphertext: context.cipher.encrypt(
          JSON.stringify({
            username: "synthetic",
            password: "synthetic",
            pid: "synthetic",
          }),
          "provider:privatehd",
        ),
      },
    });
    await db.mediaProvider.create({
      data: { id: "privatehd", enabled: true, credentialId: credential.id },
    });
    const calls: string[] = [];
    const providers = new DatabaseProviderRegistry(
      db,
      context.cipher,
      (url) => {
        calls.push(url.pathname);
        return Promise.resolve(
          Response.json(
            url.pathname.endsWith("/auth")
              ? { token: "synthetic" }
              : { data: [] },
          ),
        );
      },
    );
    const movie = createMovieNetworkFacetV4({ ...context, providers });
    const first = await movie.reconcileMovieIntentV4(
      f.input,
      testPlexBindingExecution(),
    );
    expect(first).toMatchObject({
      status: "waiting",
      reason: "provider_deferred",
    });
    expect(calls).toEqual(["/api/v1/jackett/auth"]);
    expect(
      await db.mediaProvider.findUniqueOrThrow({ where: { id: "privatehd" } }),
    ).toMatchObject({ lastError: null });
    if (
      !("providerSearchProgress" in first) ||
      first.providerSearchProgress === undefined
    )
      throw new Error("Cold tracker omitted its paging checkpoint");
    expect(first.providerSearchProgress.completedProviderIds).toEqual([]);
    await db.providerLease.update({
      where: { providerId: "privatehd" },
      data: { nextAllowedAt: new Date(Date.now() - 1) },
    });
    expect(
      await movie.reconcileMovieIntentV4(
        { ...f.input, providerSearchProgress: first.providerSearchProgress },
        testPlexBindingExecution(),
      ),
    ).toMatchObject({ status: "waiting", reason: "no_acceptable_release" });
    expect(calls).toEqual(["/api/v1/jackett/auth", "/api/v1/jackett/torrents"]);
  } finally {
    await f.close();
  }
});
