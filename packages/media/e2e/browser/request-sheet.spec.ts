import { expect, type Page, type Request } from "@playwright/test";
import { z } from "zod";
import { DefaultCommandV2Schema } from "#shared/editions/commands.ts";
import { MovieRequestV4Schema } from "#shared/movie-editions/lifecycle/lifecycle-v4.ts";
import { titleNamed } from "#testing/fixture-api/fixtures/titles.ts";
import { KIDS } from "#testing/fixture-api/personas.ts";
import {
  allowWrites,
  horizontalOverflow,
  openSettled,
  test,
  violationDetails,
} from "./support.ts";

/*
 * The request sheet: a native modal dialog opened from a title page. Runs at
 * both viewports, where it is a centred panel and a sheet from the foot of
 * the screen.
 */

const CATALOG_MOVIE = "/catalog/movie/155";
const CATALOG_SERIES = "/catalog/series/1398";
const SCHEMES = ["light", "dark"] as const;
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/u;

async function open(page: Page, persona: "owner" | "member", path: string) {
  await openSettled(page, persona, path);
  await allowWrites(page);
}

/**
 * The page's own Request button. The sheet is rendered beside it, and its
 * submit button has the same name, so the opener is told apart by its type.
 */
const opener = (page: Page) =>
  page
    .getByRole("main")
    .locator('button[type="button"]')
    .filter({ hasText: /^Request$/u });

/** The series, season and episode commands a test's sheet sent, as the API reads them. */
async function televisionCommands(page: Page) {
  const sent: Request[] = [];
  await page.route(/\/api\/v2\/media\/[^/]+\/commands$/u, async (route) => {
    sent.push(route.request());
    const command = DefaultCommandV2Schema.parse(
      route.request().postDataJSON(),
    );
    await route.fulfill({
      json: {
        schemaVersion: 2,
        scope: command.scope,
        result: { status: "queued" },
        appliedVersions: { mediaVersion: 9, targetVersion: 5 },
      },
    });
  });
  return {
    requests: sent,
    commands: () =>
      sent.map((request) =>
        DefaultCommandV2Schema.parse(request.postDataJSON()),
      ),
  };
}

for (const scheme of SCHEMES) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test("opens, is walked through and closes from the keyboard alone", async ({
      page,
    }) => {
      await open(page, "member", CATALOG_MOVIE);
      await opener(page).focus();
      await page.keyboard.press("Enter");
      const sheet = page.getByRole("dialog", {
        name: "Request The Dark Knight",
      });
      await expect(sheet).toBeVisible();
      // A modal: the page behind is inert, and focus starts on the first
      // question.
      expect(await sheet.evaluate((dialog) => dialog.matches(":modal"))).toBe(
        true,
      );
      await expect(sheet.getByLabel("Version")).toBeFocused();
      expect(await violationDetails(page)).toEqual([]);

      // Tab reaches every control, in reading order.
      for (const control of [
        sheet.getByRole("checkbox", { name: "English" }),
        sheet.getByRole("checkbox", { name: "Chinese (Simplified)" }),
        sheet.locator("summary").filter({ hasText: "More languages" }),
        sheet.getByRole("button", { name: "Cancel" }),
        sheet.getByRole("button", { name: "Request" }),
      ]) {
        await page.keyboard.press("Tab");
        await expect(control).toBeFocused();
      }
      // Focus stays inside: the page's own Request button is never reached.
      await page.keyboard.press("Tab");
      await expect(opener(page)).not.toBeFocused();

      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
      await expect(opener(page)).toBeFocused();
    });

    test("the owner's sheet asks who it is for and how long to keep it", async ({
      page,
    }) => {
      await open(page, "owner", CATALOG_SERIES);
      await opener(page).click();
      const sheet = page.getByRole("dialog", { name: "Request The Sopranos" });
      const forWhom = sheet.getByLabel("Who is it for");
      await expect(forWhom).toBeFocused();
      await expect(forWhom.getByRole("option")).toHaveText([
        "Me",
        KIDS.displayName,
      ]);

      // Sending it unanswered says what is missing instead of doing nothing.
      await sheet.getByRole("button", { name: "Request" }).click();
      await expect(sheet.getByRole("alert")).toHaveText(
        "Choose how long to keep it.",
      );
      await sheet.getByRole("radio", { name: /^Keep just for now/u }).check();
      await expect(sheet.getByRole("alert")).toHaveCount(0);

      // Season choice: the whole series, or some of it.
      const future = sheet.getByRole("checkbox", {
        name: "Get new episodes as they air",
      });
      await expect(future).toBeChecked();
      await sheet.getByRole("radio", { name: /^Only some seasons/u }).check();
      await expect(future).toHaveCount(0);
      await expect(sheet.getByRole("alert")).toHaveText(
        "Choose at least one season.",
      );
      await sheet
        .getByRole("checkbox", { name: "Season 2, 13 episodes" })
        .check();
      await expect(sheet.getByRole("alert")).toHaveCount(0);

      // The language picker: two up front, the rest one step away.
      const more = sheet.locator("summary");
      await more.click();
      await sheet.getByRole("checkbox", { name: "French" }).check();
      await expect(more).toHaveText("More languages, 1 chosen");
      expect(await violationDetails(page)).toEqual([]);
      expect(await horizontalOverflow(page)).toBe(0);
    });
  });
}

test("a press on the backdrop closes it and returns focus", async ({
  page,
}) => {
  await open(page, "member", CATALOG_MOVIE);
  await opener(page).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  // A press inside the sheet does not close it.
  await sheet.getByRole("heading").click();
  await expect(sheet).toBeVisible();
  await page.mouse.click(4, 4);
  await expect(sheet).toBeHidden();
  await expect(opener(page)).toBeFocused();
  // Cancel does the same.
  await opener(page).click();
  await sheet.getByRole("button", { name: "Cancel" }).click();
  await expect(sheet).toBeHidden();
  await expect(opener(page)).toBeFocused();
});

test("a member's series request is the command the API takes", async ({
  page,
}) => {
  const series = titleNamed("Succession");
  await open(page, "member", `/media/${series.id}`);
  const sent = await televisionCommands(page);
  await opener(page).click();
  const sheet = page.getByRole("dialog", { name: "Request Succession" });
  // A member is not asked who it is for or how long to keep it.
  await expect(sheet.getByLabel("Who is it for")).toHaveCount(0);
  await expect(
    sheet.getByText(/It stays in the library while you follow it/u),
  ).toBeVisible();
  await sheet.getByRole("checkbox", { name: "Chinese (Simplified)" }).check();
  await sheet.getByRole("button", { name: "Request" }).click();

  // The confirmation uses the button's own word.
  await expect(sheet.getByRole("status")).toContainText("Requested.");
  expect(sent.commands()).toEqual([
    expect.objectContaining({
      scope: { mediaId: series.id, edition: "default" },
      // No requester: the server reads the request as the member's own.
      command: {
        action: "request",
        keepingPolicy: "temporary",
        subtitleLanguages: ["en", "zh-Hans"],
        includeFutureEpisodes: true,
        includeSpecials: false,
      },
    }),
  ]);
  // The same CSRF and retry-key handling as every other write.
  const headers = sent.requests[0]?.headers() ?? {};
  expect(headers["x-csrf-token"]).toBe("browser-test");
  expect(headers["idempotency-key"]).toMatch(UUID);

  await expect(sheet.getByRole("button", { name: "Done" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(sheet).toBeHidden();
  await expect(opener(page)).toBeFocused();
});

test("choosing seasons asks for each season on its own", async ({ page }) => {
  const series = titleNamed("Succession");
  await open(page, "member", `/media/${series.id}`);
  const sent = await televisionCommands(page);
  await opener(page).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("radio", { name: /^Only some seasons/u }).check();
  await sheet.getByRole("checkbox", { name: "Season 3" }).check();
  await sheet.getByRole("checkbox", { name: "Season 1" }).check();
  await sheet.getByRole("button", { name: "Request" }).click();
  await expect(sheet.getByRole("status")).toContainText("Requested.");

  // Two seasons, two commands, neither of them for the whole series.
  const commands = sent.commands();
  expect(commands).toHaveLength(2);
  const asked = commands.map((command) => command.scope.mediaId);
  expect(new Set(asked).size).toBe(2);
  expect(asked).not.toContain(series.id);
  for (const { command } of commands) {
    expect(command).toMatchObject({
      action: "request",
      includeFutureEpisodes: false,
      includeSpecials: false,
    });
  }
});

test("a batch that stops part-way keeps its answers and asks only for what is left", async ({
  page,
}) => {
  const series = titleNamed("Succession");
  await open(page, "member", `/media/${series.id}`);
  const attempts: unknown[] = [];
  await page.route(/\/api\/v2\/media\/[^/]+\/commands$/u, async (route) => {
    const command = DefaultCommandV2Schema.parse(
      route.request().postDataJSON(),
    );
    attempts.push(command);
    // The second season's command is refused the first time it arrives.
    if (attempts.length === 2) {
      await route.fulfill({
        status: 422,
        json: {
          error: {
            code: "invalid_request_scope",
            message: "Season 2 cannot be asked for right now.",
          },
        },
      });
      return;
    }
    await route.fulfill({
      json: {
        schemaVersion: 2,
        scope: command.scope,
        result: { status: "queued" },
        appliedVersions: { mediaVersion: 9, targetVersion: 5 },
      },
    });
  });
  await opener(page).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("radio", { name: /^Only some seasons/u }).check();
  await sheet.getByRole("checkbox", { name: "Season 1" }).check();
  await sheet.getByRole("checkbox", { name: "Season 2" }).check();
  const submit = sheet.getByRole("button", { name: "Request" });
  await submit.click();

  // Season 1 went through and season 2 did not: the sheet says both.
  await expect(sheet.locator(".notice-error")).toContainText(
    "Season 2 cannot be asked for right now.",
  );
  await expect(sheet.getByRole("status")).toContainText(
    "Season 1 is requested. Season 2 is not yet.",
  );
  // The answers are the ones season 1 was asked for with; they cannot be
  // changed for the rest of the batch.
  for (const control of [
    sheet.getByRole("checkbox", { name: "Chinese (Simplified)" }),
    sheet.getByRole("checkbox", { name: "English" }),
    sheet.getByRole("checkbox", { name: "Season 1" }),
    sheet.getByRole("checkbox", { name: "Season 3" }),
    sheet.getByRole("radio", { name: /^The whole series/u }),
  ]) {
    await expect(control).toBeDisabled();
  }
  expect(await violationDetails(page)).toEqual([]);
  expect(await horizontalOverflow(page)).toBe(0);

  await submit.click();
  await expect(sheet.getByRole("status")).toContainText("Requested.");
  // Three commands: season 1 once, then season 2 twice. The retry is the
  // refused command again, unchanged, and season 1 is not asked for twice.
  const commands = z.array(DefaultCommandV2Schema).length(3).parse(attempts);
  const [first, refused, retried] = commands;
  expect(retried).toEqual(refused);
  expect(first?.scope.mediaId).not.toBe(refused?.scope.mediaId);
  expect(first?.command).toEqual(refused?.command);
});

test("the owner's film request names the version, and a retry is the same request", async ({
  page,
}) => {
  const film = titleNamed("Interstellar");
  await open(page, "owner", CATALOG_MOVIE);
  await page.route(/\/api\/v1\/catalog\/adopt$/u, async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      kind: "movie",
      externalId: 155,
    });
    await route.fulfill({ status: 201, json: { mediaId: film.id } });
  });
  const attempts: Request[] = [];
  await page.route(
    /\/api\/v4\/media\/[^/]+\/movie-requests$/u,
    async (route) => {
      attempts.push(route.request());
      if (attempts.length === 1) {
        // The connection drops: whether it was applied is unknown.
        await route.abort("connectionreset");
        return;
      }
      const body = MovieRequestV4Schema.parse(route.request().postDataJSON());
      await route.fulfill({
        json: {
          schemaVersion: 4,
          mediaId: film.id,
          subjectUserId: body.subjectUserId,
          edition: body.selection.edition,
          requestId: "00000005-0000-4000-8000-0000000000aa",
          choiceId: "00000009-0000-4000-8000-0000000000aa",
          state: "pending",
          reason: null,
          applied: {
            mediaVersion: 4,
            targetVersion: 1,
            requestVersion: 1,
            choiceRevision: 1,
          },
          operationId: null,
        },
      });
    },
  );
  await opener(page).click();
  const sheet = page.getByRole("dialog", { name: "Request The Dark Knight" });
  await sheet
    .getByLabel("Who is it for")
    .selectOption({ label: KIDS.displayName });
  await sheet.getByLabel("Version").selectOption({ label: "Director’s cut" });
  await expect(
    sheet.getByText(/Media looks for exactly this cut/u),
  ).toBeVisible();
  await sheet.getByRole("radio", { name: /^Keep for good/u }).check();
  const submit = sheet.getByRole("button", { name: "Request" });
  await submit.click();

  // An unknown outcome is retried exactly as it was sent: the answers lock.
  await expect(sheet.locator(".notice-error")).toBeVisible();
  await expect(sheet.getByLabel("Version")).toBeDisabled();
  await submit.click();
  await expect(sheet.getByRole("status")).toContainText("Requested.");
  await expect(sheet).toContainText("Your request is saved");

  const bodies = z
    .array(MovieRequestV4Schema)
    .length(2)
    .parse(attempts.map((attempt): unknown => attempt.postDataJSON()));
  expect(bodies[0]).toMatchObject({
    mediaId: film.id,
    subjectUserId: KIDS.id,
    selection: { edition: "directors_cut" },
    options: { subtitleLanguages: ["en"], keepingPolicy: "keep" },
  });
  expect(bodies[1]).toEqual(bodies[0]);
  const keys = attempts.map((attempt) => attempt.headers()["idempotency-key"]);
  expect(keys[0]).toMatch(UUID);
  expect(keys[1]).toBe(keys[0]);

  // The film is in the library now: closing the sheet opens its own page.
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(page).toHaveURL(new RegExp(`/media/${film.id}$`, "u"));
});
