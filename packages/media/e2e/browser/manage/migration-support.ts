import { expect, type Page } from "@playwright/test";
import { CAPTURES } from "#testing/fixture-api/fixtures/migration/migration.ts";
import {
  migrationBundles,
  migrationProposals,
} from "#testing/fixture-api/fixtures/owner.ts";
import { sha256 } from "#testing/fixture-api/support.ts";

export function proposalSummary(kind: "radarr" | "sonarr") {
  const summary = migrationProposals().find(
    (proposal) =>
      proposal.source.kind === kind &&
      proposal.id === CAPTURES[kind].proposalId,
  );
  if (summary === undefined) throw new Error(`No ${kind} capture fixture`);
  return summary;
}

export function bundleSummary(id: string) {
  const summary = migrationBundles().find((bundle) => bundle.id === id);
  if (summary === undefined) throw new Error(`No report fixture ${id}`);
  return summary;
}

export async function openCapture(page: Page, name: RegExp) {
  await page.getByRole("button", { name }).first().click();
  await expect(page.getByRole("heading", { name: /^Review: / })).toBeVisible();
}

export async function openReport(page: Page, index: number) {
  await page
    .getByRole("button", { name: /Review the report built/u })
    .nth(index)
    .click();
  await expect(
    page.getByRole("heading", { name: /^Library report built / }),
  ).toBeVisible();
}

export const SNAPSHOT = {
  schemaVersion: 1,
  sourceInstanceId: sha256("instance-sonarr"),
  sourceKind: "sonarr",
  sourceVersion: "4.0.11.2680",
  startedAt: "2026-11-01T10:00:00.000Z",
  completedAt: "2026-11-01T10:05:00.000Z",
  endpoints: [
    {
      name: "media",
      pages: 1,
      records: 0,
      complete: true,
      stable: true,
      digest: sha256("endpoint-media"),
      reason: "complete",
    },
  ],
  records: [],
};
