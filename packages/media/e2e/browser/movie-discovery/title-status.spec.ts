import { expect, type Page } from "@playwright/test";
import { openSettled, test } from "#e2e/browser/support.ts";
import {
  MovieTargetContextV4Schema,
  type MovieDiscoveryStatus,
} from "#shared/movie-editions/lifecycle/public-v4.ts";
import { titleNamed } from "#testing/fixture-api/fixtures/titles.ts";

async function discoveryResponse(
  page: Page,
  mediaId: string,
  discovery: MovieDiscoveryStatus,
) {
  const path = `/api/v4/media/${mediaId}/movie-editions/default`;
  await page.route(
    (url) => url.pathname === path && url.searchParams.get("discovery") === "1",
    async (route) => {
      const original = await route.fetch();
      const target = MovieTargetContextV4Schema.parse(await original.json());
      if (target.access !== "detail" || target.progress === null)
        throw new Error("Fixture omitted the edition's progress");
      await route.fulfill({
        response: original,
        json: { ...target, progress: { ...target.progress, discovery } },
      });
    },
  );
}

const wanted = titleNamed("Oppenheimer").id;
for (const [discovery, label] of [
  ["searching", "Looking for a release"],
  ["retrying", "Retrying the download"],
  ["waiting_for_release", "Waiting for a matching release"],
  ["plex_exclusion_proof_required", "Plex scanner setup needed"],
] as const) {
  test(`the title distinguishes ${label.toLowerCase()} from download availability`, async ({
    page,
  }) => {
    await discoveryResponse(page, wanted, discovery);
    await openSettled(page, "owner", `/media/${wanted}`);
    await expect(page.getByText(label, { exact: true })).toBeVisible();
    if (discovery === "plex_exclusion_proof_required") {
      await expect(
        page.getByRole("status").filter({
          hasText:
            "The library owner needs to verify the Plex scanner setup for Movies before downloads can start.",
        }),
      ).toBeVisible();
    }
  });
}

test("an older target response preserves the title's existing status", async ({
  page,
}) => {
  await openSettled(page, "owner", `/media/${wanted}`);
  await expect(page.getByText("Not found yet", { exact: true })).toBeVisible();
});

test("a playable copy keeps its availability even during a release search", async ({
  page,
}) => {
  const available = titleNamed("Interstellar").id;
  await discoveryResponse(page, available, "searching");
  await openSettled(page, "owner", `/media/${available}`);
  await expect(
    page.getByText("Looking for a release", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Ready to watch", { exact: true })).toBeVisible();
});
