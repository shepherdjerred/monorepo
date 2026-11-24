import { expect, test, vi } from "vitest";
import { createMovieWorkflowFixture } from "#testing/movie-workflow/fixture.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { NativeArchiveScopeProtection } from "#infrastructure/native-archive/errors.ts";
import { searchMovieCandidatesV4 } from "./candidates.ts";
import type { MediaAutomationContext } from "#automation/context.ts";
import type { ProviderCandidate } from "#integrations/providers.ts";
import { MovieReconcileOperationV4Schema } from "#shared/movie-editions/lifecycle/automation-v4.ts";
import { createMovieNetworkFacetV4 } from "./activities.ts";

test("a personal named search exhausts its original pre-spent99 allowance before provider access", async () => {
  const f = await createMovieWorkflowFixture("directors_cut");
  try {
    const before = {
      command: await f.source.db.operation.findUniqueOrThrow({
        where: { id: f.input.operationId },
      }),
      choices: await f.source.db.movieEditionChoice.findMany({
        where: { rootMediaId: f.input.scope.rootMediaId },
      }),
      requests: await f.source.db.mediaRequest.findMany({
        where: { mediaId: f.input.mediaId },
      }),
    };
    const budget = new PublicationAuthorityReadBudget();
    budget.consume(99);
    let providerCalls = 0;
    const context: MediaAutomationContext = {
      ...f.source.context,
      movieManagement: { execution: testPlexBindingExecution(), budget },
      providers: {
        withProvider: (id, work) => {
          providerCalls++;
          return f.source.context.providers.withProvider(id, work);
        },
      },
    };
    await expect(
      searchMovieCandidatesV4(context, f.input.scope),
    ).rejects.toThrow(NativeArchiveScopeProtection);
    expect(providerCalls).toBe(0);
    expect(budget.take).toBeLessThanOrEqual(0);
    expect(await f.source.db.acquisitionAttempt.count()).toBe(0);
    expect(await f.source.db.releaseCandidate.count()).toBe(0);
    expect(await f.source.db.torrent.count()).toBe(0);
    expect(
      await f.source.db.operation.findUniqueOrThrow({
        where: { id: f.input.operationId },
      }),
    ).toEqual(before.command);
    expect(
      await f.source.db.movieEditionChoice.findMany({
        where: { rootMediaId: f.input.scope.rootMediaId },
      }),
    ).toEqual(before.choices);
    expect(
      await f.source.db.mediaRequest.findMany({
        where: { mediaId: f.input.mediaId },
      }),
    ).toEqual(before.requests);
  } finally {
    await f.close();
  }
}, 60_000);

test("normal movie search ranks 110 delayed releases across providers and reserves the best unchanged source once", async () => {
  const f = await createMovieWorkflowFixture("default");
  const { db, context } = f.source;
  try {
    const selection = {
      minimumSeeders: 1,
      delaySeconds: 900,
      bypassAtHighestQuality: false,
    };
    await db.mediaProvider.update({
      where: { id: "knaben" },
      data: { configuration: { selection: { ...selection, priority: 5 } } },
    });
    await db.mediaProvider.create({
      data: {
        id: "thepiratebay",
        enabled: true,
        configuration: { selection: { ...selection, priority: 25 } },
      },
    });
    const [source] = await context.providers.withProvider("knaben", (client) =>
      client.search({ query: "Workflow Fixture", kind: "movie", page: 1 }),
    );
    if (source === undefined) throw new Error("Fixture omitted its release");
    const providers = ["knaben", "thepiratebay"] as const;
    const releases = new Map<string, ProviderCandidate[]>(
      providers.map((providerId) => [
        providerId,
        Array.from({ length: 55 }, (_, index): ProviderCandidate => {
          const id = crypto.randomUUID();
          const hash = id.replaceAll("-", "").padEnd(40, "0");
          return {
            ...source,
            providerId,
            providerReleaseId: id,
            title:
              index === 54 || (index === 0 && providerId === "knaben")
                ? source.title.replace("1080p", "2160p")
                : source.title,
            infoHash: hash,
            download: { kind: "magnet", value: `magnet:?xt=urn:btih:${hash}` },
          };
        }),
      ]),
    );
    const now = vi.fn(() => new Date());
    const movie = createMovieNetworkFacetV4({
      ...context,
      now,
      providers: {
        withProvider: (id, work) =>
          work({
            search: () => {
              const sources = releases.get(id);
              if (sources === undefined)
                throw new Error("Unknown test provider");
              return Promise.resolve(sources);
            },
          }),
      },
    });
    expect(
      await movie.reconcileMovieIntentV4(f.input, testPlexBindingExecution()),
    ).toMatchObject({ status: "waiting", attemptId: null });
    expect(await db.releaseCandidate.count()).toBe(110);
    expect(await db.acquisitionAttempt.count()).toBe(0);
    const delayed = await db.operation.findMany({
      where: { idempotencyKey: { startsWith: "provider-delay:" } },
      include: { outbox: true },
    });
    expect(delayed).toHaveLength(1);
    const bounds = await db.releaseCandidate.aggregate({
      _min: { createdAt: true },
      _max: { createdAt: true },
    });
    const first = bounds._min.createdAt;
    const last = bounds._max.createdAt;
    if (first === null || last === null)
      throw new Error("Fixture omitted persisted release timestamps");
    expect(delayed[0]?.outbox?.availableAt).toEqual(
      new Date(first.getTime() + 900_000),
    );
    const wake = delayed[0];
    if (wake === undefined) throw new Error("Missing provider-delay wakeup");
    expect(wake.payload).toMatchObject({
      schemaVersion: 4,
      mediaId: f.input.mediaId,
      scope: f.input.scope,
      generation: f.input.generation,
      operationId: wake.id,
    });
    const resume = MovieReconcileOperationV4Schema.parse({
      ...f.input,
      operationId: wake.id,
    });
    const highPriority = releases.get("knaben");
    const conflict = highPriority?.[0];
    const winner = highPriority?.[54];
    if (
      highPriority === undefined ||
      conflict === undefined ||
      winner === undefined
    )
      throw new Error("Missing provider ranking fixture");
    const identity = {
      providerId_providerReleaseId: {
        providerId: conflict.providerId,
        providerReleaseId: conflict.providerReleaseId,
      },
    };
    const retained = await db.releaseCandidate.findUniqueOrThrow({
      where: identity,
    });
    highPriority[0] = { ...conflict, title: `${conflict.title}.REPACK` };
    now.mockReturnValue(new Date(last.getTime() + 900_000));
    const result = await movie.reconcileMovieIntentV4(
      resume,
      testPlexBindingExecution(),
    );
    expect(result).toMatchObject({ status: "acquire", reason: null });
    const attempts = await db.acquisitionAttempt.findMany({
      include: { release: true },
    });
    expect(attempts).toMatchObject([
      {
        id: result.attemptId,
        state: "reserved",
        release: { providerReleaseId: winner.providerReleaseId },
      },
    ]);
    expect(await db.acquisitionReservation.count()).toBe(1);
    expect(
      await db.releaseCandidate.findUniqueOrThrow({ where: identity }),
    ).toEqual(retained);
    expect(
      await movie.reconcileMovieIntentV4(resume, testPlexBindingExecution()),
    ).toMatchObject({ attemptId: result.attemptId });
    expect(await db.acquisitionAttempt.count()).toBe(1);
  } finally {
    await f.close();
  }
}, 60_000);
