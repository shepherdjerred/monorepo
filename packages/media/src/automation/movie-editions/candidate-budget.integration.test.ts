import { expect, test } from "vitest";
import { createMovieWorkflowFixture } from "#testing/movie-workflow/fixture.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { NativeArchiveScopeProtection } from "#infrastructure/native-archive/errors.ts";
import { searchMovieCandidatesV4 } from "./candidates.ts";
import type { MediaAutomationContext } from "#automation/context.ts";

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
