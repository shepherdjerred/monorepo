import type { MediaAutomationContext } from "#automation/context.ts";
import { serializable } from "#automation/store.ts";
import type { MediaOperation } from "#shared/automation.ts";
import type { ReleaseCandidate } from "#generated/prisma/client.ts";
import { parseSeriesSeasonSetV1 } from "#domain/acquisition-identity/series-season-set.ts";
import { assessSeriesPackV1 } from "./assessment.ts";
import { recordSeriesPackSelectionV1 } from "#infrastructure/acquisition-identity/series-pack/selection.ts";
import { seriesPackChanged } from "#infrastructure/acquisition-identity/series-pack/catalog.ts";

/** IDs-only Workflow input stays literal; a current Activity records the separate interpretation it actually selected. */
export async function selectSeriesPackV1(
  context: MediaAutomationContext,
  input: { command: MediaOperation; release: ReleaseCandidate },
) {
  const release = input.release;
  const syntax = parseSeriesSeasonSetV1(release.title);
  if (syntax.status === "not_applicable") return null;
  const invocation = context.libraryManagement;
  if (invocation === undefined)
    throw seriesPackChanged(
      "A derived selection needs its original Activity allowance",
    );
  invocation.budget.consume(1);
  if (syntax.status !== "resolved")
    throw seriesPackChanged(
      "Conflicting or invalid range cannot select a pack",
    );
  const parent = await assessSeriesPackV1(context, {
    releaseId: release.id,
    primaryMediaId: input.command.mediaId,
  });
  return serializable(context.db, (tx) =>
    recordSeriesPackSelectionV1(
      tx,
      {
        operationId: input.command.operationId,
        primaryMediaId: input.command.mediaId,
        generation: input.command.generation,
        captured: parent.captured,
      },
      invocation,
    ),
  );
}
