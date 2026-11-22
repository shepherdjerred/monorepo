import { expect, type Page } from "@playwright/test";
import { z } from "zod";
import { DefaultCommandV2Schema } from "#shared/editions/commands.ts";
import { MovieLifecycleCommandV4Schema } from "#shared/movie-editions/lifecycle/lifecycle-v4.ts";
import { FEATURED, titleNamed } from "#testing/fixture-api/fixtures/titles.ts";
import {
  horizontalOverflow as overflow,
  openAs,
  openSettled,
  test,
} from "#e2e/browser/support.ts";
import { answerWrites, openManage, violations } from "./support.ts";

/*
 * The owner's Manage view of one title (`?view=manage`): its panels in the
 * order the owner asks about a title, and every write it can send. The fixture
 * API refuses writes, so each test answers the request itself and asserts
 * exactly what the page sent. Runs at both viewports.
 */

const movie = FEATURED.movie;
const series = FEATURED.series;
const available = titleNamed("Breaking Bad");
const manage = (id: string) => `/media/${id}?view=manage`;

const PANELS_OF_A_SERIES = [
  "Where it stands",
  "What is happening now",
  "Change how it is acquired or kept",
  "What files it has",
  "Releases and how they were judged",
  "What happened before",
];

async function panelHeadings(page: Page): Promise<string[]> {
  return page
    .getByRole("main")
    .locator("section[aria-labelledby] > header > h2")
    .allTextContents();
}

/** Answers the target commands the page sends, and returns what it sent. */
async function answerCommands(
  page: Page,
  mediaId: string,
  status: "completed" | "queued",
): Promise<unknown[]> {
  const sent: unknown[] = [];
  await page.route(/\/api\/v2\/media\/[^/]+\/commands$/u, async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({
      json: {
        schemaVersion: 2,
        scope: { mediaId, edition: "default" },
        result: { status },
        appliedVersions: { mediaVersion: 9, targetVersion: 5 },
      },
    });
  });
  return sent;
}

/** The version of a title the page was loaded at, as its commands name it. */
async function mediaVersion(page: Page, id: string): Promise<number> {
  const response = await page.request.get(`/api/v1/media/${id}`);
  return z.object({ version: z.number() }).parse(await response.json()).version;
}

test.describe("a series", () => {
  test("answers where it stands, what is happening, what can change, and what happened", async ({
    page,
  }) => {
    await openManage(page, manage(series.id));
    expect(await panelHeadings(page)).toEqual(PANELS_OF_A_SERIES);

    const standing = page.getByRole("region", { name: "Where it stands" });
    await expect(standing).toContainText("Availability");
    await expect(standing).toContainText("Living room 4K — TV");
    await expect(standing).toContainText("Robin, Sam");
    await expect(standing).toContainText("Protected until");

    const now = page.getByRole("region", { name: "What is happening now" });
    await expect(now).toContainText("Some episodes ready");
    await expect(now.getByText("Download 3", { exact: true })).toBeVisible();
    await expect(now).toContainText("Acquisition history (4)");

    const history = page.getByRole("region", { name: "What happened before" });
    await expect(history.getByRole("listitem")).toHaveCount(4);

    expect(await overflow(page)).toBe(0);
    expect(await violations(page)).toEqual([]);
  });

  test("raw records stay behind Technical details until asked for", async ({
    page,
  }) => {
    await openManage(page, manage(series.id));
    const releases = page.getByRole("region", {
      name: "Releases and how they were judged",
    });
    const first = releases.locator("details").first();
    await first.locator("summary").first().click();
    await expect(first).toContainText("Accepted");
    // The reasons a release was rejected are words; the record is behind a
    // disclosure of its own.
    const rejected = releases.locator("details", {
      hasText: "CAM.x264-NOGRP",
    });
    await rejected.locator("summary").first().click();
    await expect(rejected).toContainText("Reasons recorded");
    await expect(rejected).toContainText("Quality rejected");
    const record = rejected.locator("pre");
    await expect(record).toBeHidden();
    await rejected.getByText("Technical details").click();
    await expect(record).toContainText('"identityConfidence": "mismatch"');
    await expect(record).toContainText('"evaluation"');
    // A long line scrolls inside its block; it never widens the panel.
    const block = await record.boundingBox();
    const panel = await releases.boundingBox();
    if (block === null || panel === null) throw new Error("No box to measure");
    expect(block.x + block.width).toBeLessThanOrEqual(panel.x + panel.width);
    expect(await overflow(page)).toBe(0);
  });

  test("a quality profile is changed in a form that names what it sends", async ({
    page,
  }) => {
    await openManage(page, manage(series.id));
    const writes = await answerWrites(page, `/media/${series.id}/profile`);
    const version = await mediaVersion(page, series.id);
    const select = page.getByRole("combobox", { name: "Quality profile" });
    await expect(select).toHaveValue("0000000f-0000-4000-8000-000000000003");

    // The profile already assigned is refused before anything is sent.
    await page.getByRole("button", { name: "Apply profile" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "This profile is already assigned.",
    );
    expect(writes).toEqual([]);

    await select.selectOption({ label: "Anime 1080p" });
    await page.getByRole("button", { name: "Apply profile" }).click();
    await expect(
      page.getByText("Profile change queued for evaluation."),
    ).toBeVisible();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      method: "PUT",
      path: `/api/v1/media/${series.id}/profile`,
      body: {
        profileId: "0000000f-0000-4000-8000-000000000004",
        expectedVersion: version,
      },
    });
  });

  test("a refused profile change says what failed", async ({ page }) => {
    await openManage(page, manage(series.id));
    await answerWrites(page, `/media/${series.id}/profile`, {
      status: 409,
      json: {
        error: {
          code: "version_conflict",
          message: "The title changed. Reload it and try again.",
        },
      },
    });
    await page
      .getByRole("combobox", { name: "Quality profile" })
      .selectOption({ label: "Anime 1080p" });
    await page.getByRole("button", { name: "Apply profile" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "The title changed. Reload it and try again.",
    );
    await expect(page.getByText("Unsaved changes")).toBeVisible();
  });

  test("changing the selection while a profile save is in flight keeps it pending and keeps its failure", async ({
    page,
  }) => {
    await openManage(page, manage(series.id));
    const writes: unknown[] = [];
    const held = Promise.withResolvers<boolean>();
    await page.route(`**/api/v1/media/${series.id}/profile`, async (route) => {
      writes.push(route.request().postDataJSON());
      await held.promise;
      await route.fulfill({
        status: 409,
        json: {
          error: {
            code: "version_conflict",
            message: "The title changed. Reload it and try again.",
          },
        },
      });
    });
    const select = page.getByRole("combobox", { name: "Quality profile" });
    await select.selectOption({ label: "Anime 1080p" });
    await page.getByRole("button", { name: "Apply profile" }).click();
    const applying = page.getByRole("button", { name: "Applying…" });
    await expect(applying).toBeDisabled();

    // Choosing something else does not detach the form from the save that is
    // still running: Apply stays disabled, so no second change can be sent
    // against the same version.
    await select.selectOption({ label: "HD-1080p from Radarr" });
    await expect(applying).toBeDisabled();
    expect(writes).toHaveLength(1);

    held.resolve(true);
    await expect(page.getByRole("alert")).toContainText(
      "The title changed. Reload it and try again.",
    );
    await expect(
      page.getByRole("button", { name: "Apply profile" }),
    ).toBeEnabled();
  });

  test("retrying an acquisition sends the retry command and says it was queued", async ({
    page,
  }) => {
    await openManage(page, manage(series.id));
    const sent = await answerCommands(page, series.id, "queued");
    await page.getByRole("button", { name: "Retry acquisition" }).click();
    await expect(page.getByText("Action queued")).toBeVisible();
    const [command] = z.array(DefaultCommandV2Schema).length(1).parse(sent);
    expect(command).toMatchObject({
      scope: { mediaId: series.id, edition: "default" },
      command: { action: "retry" },
    });
    await expect(
      page.getByRole("button", { name: "Retry acquisition" }),
    ).toBeDisabled();
  });

  test("a retry the server refuses as stale tells the owner to review", async ({
    page,
  }) => {
    await openManage(page, manage(series.id));
    await page.route(/\/api\/v2\/media\/[^/]+\/commands$/u, async (route) => {
      await route.fulfill({
        status: 409,
        json: {
          error: { code: "version_conflict", message: "The title changed." },
        },
      });
    });
    await page.getByRole("button", { name: "Retry acquisition" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "This title changed. Your action was not applied.",
    );
    await expect(
      page.getByRole("button", { name: "Retry acquisition" }),
    ).toBeDisabled();
  });

  test("selecting a release sends exactly that release", async ({ page }) => {
    await openManage(page, manage(series.id));
    const sent = await answerCommands(page, series.id, "queued");
    const releases = page.getByRole("region", {
      name: "Releases and how they were judged",
    });
    const flux = releases.locator("details", { hasText: "AMZN.WEB-DL" });
    await flux.locator("summary").first().click();
    await flux.getByRole("button", { name: "Select release" }).click();
    await expect(
      page.getByText(
        "Release selection queued. Track its progress in Activity.",
      ),
    ).toBeVisible();
    const [command] = z.array(DefaultCommandV2Schema).length(1).parse(sent);
    const response = await page.request.get(
      `/api/v1/media/${series.id}/releases`,
    );
    const listed = z
      .array(z.object({ id: z.string(), title: z.string() }))
      .parse(await response.json());
    const chosen = listed.find((release) => release.title.includes("AMZN"));
    expect(command).toMatchObject({
      command: { action: "select_release", releaseId: chosen?.id },
    });
  });

  test("a release list that fails to load can be tried again", async ({
    page,
  }) => {
    let failing = true;
    await page.route(/\/api\/v1\/media\/[^/]+\/releases$/u, async (route) => {
      if (failing) {
        await route.fulfill({
          status: 500,
          json: { error: { code: "internal", message: "Releases broke." } },
        });
        return;
      }
      await route.fallback();
    });
    await openSettled(page, "owner", manage(series.id));
    const releases = page.getByRole("region", {
      name: "Releases and how they were judged",
    });
    await expect(releases).toContainText("Releases could not be loaded");
    failing = false;
    await releases.getByRole("button", { name: "Try again" }).click();
    await expect(releases.locator("details").first()).toBeVisible();
  });

  test("while the title and its command versions disagree, changes are inert", async ({
    page,
  }) => {
    await page.route(
      /\/api\/v2\/media\/[^/]+\/targets\/default$/u,
      async (route) => {
        const response = await route.fetch();
        const view = z
          .object({ expected: z.object({ mediaVersion: z.number() }).loose() })
          .loose()
          .parse(await response.json());
        await route.fulfill({
          response,
          json: {
            ...view,
            expected: {
              ...view.expected,
              mediaVersion: view.expected.mediaVersion + 7,
            },
          },
        });
      },
    );
    // The notice says "loading", so the page is never "settled" while it shows.
    await openAs(page, "owner", manage(series.id));
    await expect(
      page.getByText("This title changed while its details were loading."),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Change how it is acquired or kept" })
        .locator("xpath=ancestor::*[@inert]"),
    ).toHaveCount(1);
  });
});

test.describe("an available series", () => {
  test("removing it names the titles and sends the confirmation it was shown", async ({
    page,
  }) => {
    await openManage(page, manage(available.id));
    const response = await page.request.get(`/api/v1/media/${available.id}`);
    const detail = z
      .object({
        removalConfirmation: z.object({
          media: z.array(z.object({ title: z.string() })),
        }),
      })
      .loose()
      .parse(await response.json());
    const sent = await answerCommands(page, available.id, "completed");
    await page.getByRole("button", { name: "Remove from library" }).click();
    const dialog = page.getByRole("dialog", { name: "Remove from library?" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(
      detail.removalConfirmation.media[0]?.title ?? "",
    );
    expect(await violations(page)).toEqual([]);

    // Cancelling sends nothing.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    expect(sent).toEqual([]);

    await page.getByRole("button", { name: "Remove from library" }).click();
    await dialog.getByRole("button", { name: "Remove from library" }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    const [command] = z.array(DefaultCommandV2Schema).length(1).parse(sent);
    expect(command).toMatchObject({
      command: {
        action: "remove",
        confirmation: detail.removalConfirmation,
      },
    });
  });
});

test.describe("a film", () => {
  test("has an edition panel and no title-level release list", async ({
    page,
  }) => {
    await openManage(page, manage(movie.id));
    expect(await panelHeadings(page)).toEqual([
      "Where it stands",
      "What is happening now",
      "Change how it is acquired or kept",
      "Change an edition",
      "What files it has",
      "What happened before",
    ]);
    const standing = page.getByRole("region", { name: "Where it stands" });
    await expect(standing).toContainText("unmarked edition");
    expect(await overflow(page)).toBe(0);
    expect(await violations(page)).toEqual([]);
  });

  test("an edition is chosen, read, kept and removed on its own", async ({
    page,
  }) => {
    await openManage(page, manage(movie.id));
    const panel = page.getByRole("region", { name: "Change an edition" });
    await expect(panel.getByRole("button")).toHaveCount(0);
    await panel.getByLabel("Movie edition").selectOption("default");
    await expect(
      panel.getByRole("heading", { name: /^Unmarked/u }),
    ).toBeVisible();
    await expect(panel).toContainText("Current edition file");
    await expect(panel).toContainText("Subtitle requirements pending");
    expect(await overflow(page)).toBe(0);
    expect(await violations(page)).toEqual([]);

    const sent: unknown[] = [];
    await page.route(/\/movie-editions\/default\/actions$/u, async (route) => {
      const body = MovieLifecycleCommandV4Schema.parse(
        route.request().postDataJSON(),
      );
      sent.push(body);
      await route.fulfill({
        json: {
          schemaVersion: 4,
          scope: body.scope,
          result: { status: "completed" },
          applied: { mediaVersion: 9, targetVersion: 5 },
        },
      });
    });
    await panel.getByRole("button", { name: "Keep this edition" }).click();
    await expect(
      panel.getByText(
        "Edition action accepted. Refresh the edition to review another action.",
      ),
    ).toBeVisible();
    const [kept] = z.array(MovieLifecycleCommandV4Schema).length(1).parse(sent);
    expect(kept).toMatchObject({
      scope: { mediaId: movie.id, edition: "default" },
      command: { action: "keep" },
    });

    await panel.getByRole("button", { name: "Refresh edition" }).click();
    await panel
      .getByRole("button", { name: "Remove this edition", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Remove this edition from the library?",
    });
    await expect(dialog).toContainText("Confirm removal of Dune: Part Two");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(sent).toHaveLength(1);
    await panel
      .getByRole("button", { name: "Remove this edition", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Remove this edition", exact: true })
      .click();
    await expect.poll(() => sent.length).toBe(2);
    const removed = MovieLifecycleCommandV4Schema.parse(sent[1]);
    expect(removed).toMatchObject({
      scope: { mediaId: movie.id, edition: "default" },
      command: { action: "remove" },
    });
    expect(JSON.stringify(removed)).toContain("confirmation");
  });
});

test.describe("a title with nothing recorded yet", () => {
  test("each panel says what it is waiting for", async ({ page }) => {
    await openManage(page, manage(titleNamed("Oppenheimer").id));
    await expect(
      page.getByText("No download observations are available"),
    ).toBeVisible();
    await expect(
      page.getByText("No files have been published yet."),
    ).toBeVisible();
    expect(await overflow(page)).toBe(0);
    expect(await violations(page)).toEqual([]);
  });
});

test("a member who opens the Manage address still gets the member's page", async ({
  page,
}) => {
  const manageCode: string[] = [];
  page.on("request", (request) => {
    if (/\/assets\/manage-[\w-]+\.js$/u.test(request.url())) {
      manageCode.push(request.url());
    }
  });
  await openSettled(page, "member", manage(series.id));
  await expect(
    page.getByRole("heading", { name: "In your household" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Where it stands" }),
  ).toHaveCount(0);
  expect(manageCode).toEqual([]);
});
