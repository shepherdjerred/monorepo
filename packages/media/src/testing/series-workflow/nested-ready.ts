import { z } from "zod";
import { createFutureSeriesWorkflowFixture } from "./future-role-fixture.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";

/** Actual catalog and applied series policy produce the only reserved leaf; no acquisition rows are fabricated. */
export async function readyNestedSeriesMember(memberPath: string) {
  const fixture = await createFutureSeriesWorkflowFixture({ memberPath });
  try {
    const catalog = {
      operationId: fixture.initialOperationId,
      mediaId: fixture.rootMediaId,
      cursor: null,
    };
    let catalogCursor: string | null;
    do {
      const refreshed = await fixture.refreshMediaCatalog(catalog);
      catalogCursor = refreshed.nextCursor;
    } while (catalogCursor !== null);
    const state = await fixture.evidence();
    const expansion = state.operations.find(
      (row) => row.kind === "expand_catalog_requests",
    );
    if (expansion === undefined)
      throw new Error("Actual catalog expansion command missing");
    let cursor: string | null = null;
    do {
      const page = await fixture.catalogCoverage.expandCatalogRequests(
        { ...catalog, operationId: expansion.id, cursor },
        testPlexBindingExecution(),
      );
      cursor = page.nextCursor;
    } while (cursor !== null);
    const prepared = await fixture.evidence();
    const operation = prepared.operations.find(
      (row) =>
        row.kind === "reconcile_media" && row.targetId === prepared.episode?.id,
    );
    if (operation === undefined)
      throw new Error("Actual future leaf reconciliation missing");
    const input = z
      .object({
        operationId: z.uuid(),
        mediaId: z.uuid(),
        generation: z.int().nonnegative(),
      })
      .parse(operation.payload);
    const { acquisition } = await fixture.loadAcquisition();
    const reserved = await acquisition.reconcileMediaIntent(
      input,
      testPlexBindingExecution(),
    );
    if (reserved.status !== "acquire" || reserved.attemptId === null)
      throw new Error("Actual nested series member did not reserve");
    const attempt = {
      operationId: input.operationId,
      attemptId: reserved.attemptId,
    };
    const submitted = await acquisition.submitMediaTorrent(
      attempt,
      testPlexBindingExecution(),
    );
    if (submitted.status !== "submitted")
      throw new Error("Actual nested series transfer did not submit");
    const observed = await acquisition.observeMediaAcquisition(
      attempt,
      testPlexBindingExecution(),
    );
    if (observed.status !== "ready")
      throw new Error("Actual nested series transfer is not ready");
    return { fixture, input: attempt, mediaId: input.mediaId };
  } catch (error) {
    await fixture.close();
    throw error;
  }
}
