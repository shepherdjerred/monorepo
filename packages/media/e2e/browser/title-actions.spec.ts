import { expect } from "@playwright/test";
import { z } from "zod";
import { DefaultCommandV2Schema } from "#shared/editions/commands.ts";
import { DefaultTargetViewSchema } from "#shared/editions/target-view.ts";
import { MovieLifecycleCommandV4Schema } from "#shared/movie-editions/lifecycle/lifecycle-v4.ts";
import { requestId } from "#testing/fixture-api/fixtures/requests.ts";
import {
  FEATURED,
  seasonId,
  titleNamed,
} from "#testing/fixture-api/fixtures/titles.ts";
import {
  allowWrites,
  horizontalOverflow as overflow,
  openSettled as open,
  test,
} from "./support.ts";

/*
 * The title page's one primary action, which follows the title's state for
 * the person reading, and the commands its actions send. Runs at both
 * viewports.
 */

const series = FEATURED.series;
const mediaPath = (id: string) => `/media/${id}`;

test.describe("the primary action follows the title's state", () => {
  const cases = [
    {
      name: "a member can ask for a film they do not follow",
      persona: "member",
      path: mediaPath(titleNamed("Interstellar").id),
      action: "Request",
    },
    {
      name: "the owner can keep for good a film that is kept just for now",
      persona: "owner",
      path: mediaPath(titleNamed("Alien").id),
      action: "Keep for good",
    },
    {
      name: "the owner is told a film is kept for good",
      persona: "owner",
      path: mediaPath(titleNamed("Interstellar").id),
      action: "Kept for good",
    },
    {
      // The pin is a different thing: it never takes the switch's place.
      name: "the owner is told the same of a film they have also pinned",
      persona: "owner",
      path: mediaPath(titleNamed("Dune").id),
      action: "Kept for good",
    },
    {
      name: "a member can hold a film that is leaving soon",
      persona: "member",
      path: mediaPath(titleNamed("Get Out").id),
      action: "Keep for 30 days",
    },
    {
      name: "the owner can restore a removed film",
      persona: "owner",
      path: mediaPath(FEATURED.quarantinedMovie.id),
      action: "Restore",
    },
    {
      name: "a member follows a series",
      persona: "member",
      path: mediaPath(series.id),
      action: "Following",
    },
    {
      name: "a member can ask for a series they do not follow",
      persona: "member",
      path: mediaPath(titleNamed("Succession").id),
      action: "Request",
    },
    {
      name: "the owner can keep for good a series that is kept just for now",
      persona: "owner",
      path: mediaPath(titleNamed("Hacks").id),
      action: "Keep for good",
    },
    {
      name: "the owner is told a series is kept for good",
      persona: "owner",
      path: mediaPath(titleNamed("Succession").id),
      action: "Kept for good",
    },
    {
      // A season has no switch of its own: its keeping is its series'.
      name: "the owner can ask for a season of a series kept for good",
      persona: "owner",
      path: mediaPath(seasonId(titleNamed("Succession"), 1)),
      action: "Request",
    },
    {
      name: "a member can hold a series that is leaving soon",
      persona: "member",
      path: mediaPath(titleNamed("The Expanse").id),
      action: "Keep for 30 days",
    },
    {
      name: "a member can restore a removed series they asked for",
      persona: "member",
      path: mediaPath(titleNamed("Silo").id),
      action: "Restore",
    },
  ] as const;

  for (const { name, persona, path, action } of cases) {
    test(name, async ({ page }) => {
      await open(page, persona, path);
      const actions = page.getByRole("main").locator("header");
      await expect(
        actions.getByRole("button", { name: action, exact: true }),
      ).toBeVisible();
      // Exactly one button carries the accent: the primary action. A
      // standing, which says where the title is and opens the menu, has none.
      const standing = action === "Following" || action === "Kept for good";
      const accented = actions.locator("button.primary");
      await expect(accented).toHaveCount(standing ? 0 : 1);
      await expect(
        actions.locator('button[aria-expanded][class*="standing"]'),
      ).toHaveCount(standing ? 1 : 0);
      expect(await overflow(page)).toBe(0);
    });
  }

  test("holding a leaving film sends the keep command for that version", async ({
    page,
  }) => {
    const film = titleNamed("Get Out");
    await open(page, "member", mediaPath(film.id));
    await allowWrites(page);
    await expect(page.getByText(/unless someone keeps it/u)).toBeVisible();
    const sent: unknown[] = [];
    await page.route(/\/movie-editions\/default\/actions$/u, async (route) => {
      sent.push(route.request().postDataJSON());
      await route.fulfill({
        status: 409,
        json: {
          error: { code: "version_conflict", message: "The title changed." },
        },
      });
    });
    await page.getByRole("button", { name: "Keep for 30 days" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "This title changed. Your action was not applied.",
    );
    // Exactly one command, and one the API accepts.
    const [command] = z
      .array(MovieLifecycleCommandV4Schema)
      .length(1)
      .parse(sent);
    expect(command).toMatchObject({
      scope: { mediaId: film.id, edition: "default" },
      command: { action: "keep" },
    });
    // Nothing more is sent until the reader has looked at the title again.
    await expect(
      page.getByRole("button", { name: "Keep for 30 days" }),
    ).toBeDisabled();
  });

  test("a season a series request covers is taken out with Cancel request", async ({
    page,
  }) => {
    // The reader follows the series; the season has no interest of its own
    // to let go, so withdrawing is the way out of this one part.
    const season = seasonId(series, 2);
    await page.route(
      new RegExp(`/api/v2/media/${season}/targets/default$`, "u"),
      async (route) => {
        const response = await route.fetch();
        const context = DefaultTargetViewSchema.parse(await response.json());
        await route.fulfill({
          response,
          json: {
            ...context,
            ownRequests: [
              { id: requestId(901), version: 3, active: true, canCancel: true },
            ],
            allowedProtectiveActions: ["keep", "cancel_request"],
          },
        });
      },
    );
    await open(page, "member", mediaPath(season));
    await allowWrites(page);
    const sent: unknown[] = [];
    await page.route(/\/api\/v2\/media\/[^/]+\/commands$/u, async (route) => {
      sent.push(route.request().postDataJSON());
      await route.fulfill({
        json: {
          schemaVersion: 2,
          scope: { mediaId: season, edition: "default" },
          result: { status: "completed" },
          appliedVersions: { mediaVersion: 9, targetVersion: 5 },
        },
      });
    });
    await page.getByRole("button", { name: "Following" }).click();
    await expect(
      page.getByRole("button", { name: /^Stop following/u }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: /^Cancel request/u }).click();
    // The confirmation uses the button's own word.
    await expect(page.getByText("Request cancelled.")).toBeVisible();
    const [command] = z.array(DefaultCommandV2Schema).length(1).parse(sent);
    expect(command).toMatchObject({
      scope: { mediaId: season, edition: "default" },
      command: {
        action: "cancel_request",
        requestId: requestId(901),
        requestVersion: 3,
      },
    });
  });
});
