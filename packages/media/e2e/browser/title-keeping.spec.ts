import { expect, type Page } from "@playwright/test";
import { z } from "zod";
import { MediaDetailSchema, type MediaDetail } from "#shared/api.ts";
import {
  LibraryKeepingCommandSchema,
  RequestInterestCommandSchema,
} from "#shared/household/interests.ts";
import { libraryKeeping } from "#testing/fixture-api/fixtures/library.ts";
import {
  requestId,
  requestInterest,
  requestList,
} from "#testing/fixture-api/fixtures/requests.ts";
import {
  FEATURED,
  seasonId,
  titleNamed,
  type Title,
} from "#testing/fixture-api/fixtures/titles.ts";
import {
  allowWrites,
  horizontalOverflow as overflow,
  openSettled as open,
  test,
} from "./support.ts";

/*
 * The two household commands of the title page: the owner's keeping switch
 * and letting go of the reader's own interest. The fixture API is read-only,
 * so each test answers the command itself and, where the page must show the
 * change, the read that follows it. Runs at both viewports.
 */

const series = FEATURED.series;
const mediaPath = (id: string) => `/media/${id}`;
const KEEPING = /\/api\/v1\/library\/[^/]+\/keeping-policy$/u;
const INTEREST = /\/api\/v1\/request-interests\/[^/]+\/commands$/u;

/** From now on the title's own read answers as the fixture does, changed. */
async function rereadAs(
  page: Page,
  mediaId: string,
  change: (detail: MediaDetail) => MediaDetail,
) {
  await page.route(
    new RegExp(`/api/v1/media/${mediaId}$`, "u"),
    async (route) => {
      const response = await route.fetch();
      const detail = MediaDetailSchema.parse(await response.json());
      await route.fulfill({ response, json: change(detail) });
    },
  );
}

/** How many times the page has read the title so far. */
function countReads(page: Page, mediaId: string): () => number {
  let reads = 0;
  page.on("request", (request) => {
    if (
      request.method() === "GET" &&
      request.url().endsWith(`/api/v1/media/${mediaId}`)
    ) {
      reads += 1;
    }
  });
  return () => reads;
}

function refusal(code: string) {
  return {
    status: 409,
    json: { error: { code, message: "The server's own words." } },
  };
}

function switchOf(title: Title) {
  const keeping = libraryKeeping(title, "owner");
  if (keeping === null) throw new Error(`${title.title} has no switch`);
  return keeping;
}

function household(page: Page) {
  return page
    .getByRole("main")
    .getByRole("heading", { name: "In your household" })
    .locator("..");
}

/*
 * A page can still be reading the title when a test's last assertion passes.
 * Its answer is a route handler that is awaiting the real read, and the
 * browser context is torn down under it, which fails the test with "Response
 * has been disposed". Waiting for the handlers first lets every read finish.
 */
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
});

test.describe("how long the library keeps a title", () => {
  const film = titleNamed("Alien");

  test("the owner turns the switch on and back off, at the versions the page read", async ({
    page,
  }) => {
    const read = switchOf(film);
    expect(read.keepingPolicy).toBe("temporary");
    await open(page, "owner", mediaPath(film.id));
    await allowWrites(page);
    await expect(household(page)).toContainText(
      "Just for now: it stays while someone follows it",
    );
    const sent: unknown[] = [];
    await page.route(KEEPING, async (route) => {
      const command = LibraryKeepingCommandSchema.parse(
        route.request().postDataJSON(),
      );
      sent.push(command);
      const applied = {
        mediaVersion: command.expectedMediaVersion + 1,
        targetVersion: command.expectedTargetVersion + 1,
        keepingPolicy: command.keepingPolicy,
      };
      // The newest answer to the title's read is the one the page gets.
      await rereadAs(page, film.id, (detail) => ({
        ...detail,
        policy: command.keepingPolicy,
        libraryKeeping: applied,
      }));
      await route.fulfill({
        json: {
          schemaVersion: 1,
          mediaId: command.mediaId,
          edition: command.edition,
          ...applied,
        },
      });
    });

    const header = page.getByRole("main").locator("header");
    await header.getByRole("button", { name: "Keep for good" }).click();
    // The confirmation uses the button's own word, and the switch now says
    // where it stands and holds the way back.
    await expect(page.getByText("Kept for good.")).toBeVisible();
    const kept = header.getByRole("button", { name: "Kept for good" });
    await expect(kept).toHaveAttribute("aria-expanded", "false");
    await expect(header.locator("button.primary")).toHaveCount(0);
    await expect(household(page)).toContainText(
      "For good: it stays even when nobody follows it",
    );

    await kept.click();
    await header.getByRole("button", { name: /^Keep just for now/u }).click();
    await expect(page.getByText("Kept just for now.")).toBeVisible();
    await expect(
      header.getByRole("button", { name: "Keep for good" }),
    ).toBeVisible();

    expect(sent).toEqual([
      {
        schemaVersion: 1,
        mediaId: film.id,
        edition: "default",
        expectedMediaVersion: read.mediaVersion,
        expectedTargetVersion: read.targetVersion,
        keepingPolicy: "keep",
      },
      // The second command names the versions the first one left behind.
      {
        schemaVersion: 1,
        mediaId: film.id,
        edition: "default",
        expectedMediaVersion: read.mediaVersion + 1,
        expectedTargetVersion: read.targetVersion + 1,
        keepingPolicy: "temporary",
      },
    ]);
    expect(await overflow(page)).toBe(0);
  });

  test("a title that changed under the switch is read again, and the page says so", async ({
    page,
  }) => {
    const read = switchOf(film);
    await open(page, "owner", mediaPath(film.id));
    await allowWrites(page);
    const reads = countReads(page, film.id);
    const sent: unknown[] = [];
    await page.route(KEEPING, async (route) => {
      sent.push(route.request().postDataJSON());
      // Somebody else changed the title: its target is a version further on.
      await rereadAs(page, film.id, (detail) => ({
        ...detail,
        libraryKeeping: { ...read, targetVersion: read.targetVersion + 4 },
      }));
      await route.fulfill(refusal("version_conflict"));
    });

    const keep = page.getByRole("button", { name: "Keep for good" });
    await keep.click();
    await expect(
      page.getByText(
        "This title changed before Media got that, so how long it is kept was not changed. The page now shows where it stands; choose again if you still want to.",
      ),
    ).toBeVisible();
    // The page read the title again by itself: nothing to press first.
    expect(reads()).toBeGreaterThan(0);
    await expect(
      page.getByRole("button", { name: "Review latest details" }),
    ).toHaveCount(0);
    await expect(keep).toBeEnabled();

    await keep.click();
    await expect.poll(() => sent.length).toBe(2);
    // The second refusal is read back too; let that finish before the test
    // ends, so no read is still in flight when its browser context closes.
    await page.waitForLoadState("networkidle");
    const commands = z.array(LibraryKeepingCommandSchema).parse(sent);
    expect(commands.map((command) => command.expectedTargetVersion)).toEqual([
      read.targetVersion,
      read.targetVersion + 4,
    ]);
  });

  test("the three ways of keeping are told apart where they are chosen", async ({
    page,
  }) => {
    await open(page, "owner", mediaPath(series.id));
    const header = page.getByRole("main").locator("header");
    await header.getByRole("button", { name: "Following" }).click();
    for (const [name, detail] of [
      [
        "Keep for good",
        "The library keeps it whether or not anyone follows it.",
      ],
      [
        "Keep for 30 days",
        "Nothing removes it for a month. How long the library keeps it stays as it is.",
      ],
      [
        "Pin so it never leaves",
        "Your own lock: nothing removes it until you take the pin off, however long the library keeps it.",
      ],
    ] as const) {
      await expect(
        header.getByRole("button", { name: new RegExp(`^${name}`, "u") }),
      ).toContainText(detail);
    }
    // And the section below says it once, for the one who has all three.
    await expect(household(page)).toContainText(
      "Keeping is the library’s standing choice for this title. A 30-day hold and a pin protect it on top of that choice, and leave the choice as it is.",
    );
    expect(await overflow(page)).toBe(0);
  });

  test("a member has no switch, and a season none of its own", async ({
    page,
  }) => {
    await open(page, "member", mediaPath(series.id));
    const header = page.getByRole("main").locator("header");
    await header.getByRole("button", { name: "Following" }).click();
    await expect(
      header.getByRole("button", { name: /^Keep for 30 days/u }),
    ).toBeVisible();
    await expect(
      header.getByRole("button", { name: /for good/iu }),
    ).toHaveCount(0);
    await expect(header.getByRole("button", { name: /^Pin/u })).toHaveCount(0);
    await expect(household(page)).not.toContainText("standing choice");

    await open(page, "owner", mediaPath(seasonId(titleNamed("Succession"), 1)));
    await expect(household(page)).toContainText(
      "For good, with the rest of the series",
    );
    await page.getByRole("button", { name: "More actions" }).click();
    await expect(
      page
        .getByRole("main")
        .locator("header")
        .getByRole("button", { name: /^Keep just for now/u }),
    ).toHaveCount(0);
  });
});

test.describe("leaving a title the reader follows", () => {
  const own = requestList("member").find(
    (request) => request.mediaId === series.id,
  );
  if (own === undefined) throw new Error("The member asked for the series");
  const interest = requestInterest(own.id, "member");
  const drop = {
    schemaVersion: 1,
    requestId: own.id,
    expectedVersion: own.version,
    expectedInterestRevision: interest.interestRevision,
    action: "drop",
  };

  test("Stop following lets the reader's own interest go, and the page stops saying they follow", async ({
    page,
  }) => {
    await open(page, "member", mediaPath(series.id));
    await allowWrites(page);
    await expect(household(page)).toContainText("You and Sam");
    const sent: { path: string; body: unknown }[] = [];
    await page.route(INTEREST, async (route) => {
      const command = RequestInterestCommandSchema.parse(
        route.request().postDataJSON(),
      );
      sent.push({
        path: new URL(route.request().url()).pathname,
        body: command,
      });
      // The read lists only requests that still follow the title.
      await rereadAs(page, series.id, (detail) => ({
        ...detail,
        requests: [],
        followers: (detail.followers ?? []).filter((one) => !one.me),
      }));
      await route.fulfill({
        json: {
          schemaVersion: 1,
          requestId: command.requestId,
          version: command.expectedVersion + 1,
          interestRevision: command.expectedInterestRevision + 1,
          state: "dropped",
          keepingPolicy: "temporary",
        },
      });
    });

    const header = page.getByRole("main").locator("header");
    await header.getByRole("button", { name: "Following" }).click();
    // One way out, named as the Library names it; not the request's withdrawal.
    await expect(
      header.getByRole("button", { name: /^Cancel request/u }),
    ).toHaveCount(0);
    const stop = header.getByRole("button", { name: /^Stop following/u });
    await expect(stop).toContainText(
      "Your request stays under Mine in the Library, where you can pick it up again.",
    );
    await stop.click();

    await expect(page.getByText("You no longer follow this.")).toBeVisible();
    await expect(
      header.getByRole("button", { name: "Request", exact: true }),
    ).toBeVisible();
    await expect(header.getByRole("button", { name: "Following" })).toHaveCount(
      0,
    );
    await expect(household(page)).toContainText("Sam");
    await expect(household(page)).not.toContainText("You and Sam");
    expect(sent).toEqual([
      { path: `/api/v1/request-interests/${own.id}/commands`, body: drop },
    ]);
    expect(await overflow(page)).toBe(0);
  });

  test("a stale revision is refused, read again and explained, and the next try names the new one", async ({
    page,
  }) => {
    await open(page, "member", mediaPath(series.id));
    await allowWrites(page);
    const reads = countReads(page, series.id);
    const sent: unknown[] = [];
    await page.route(INTEREST, async (route) => {
      sent.push(route.request().postDataJSON());
      if (sent.length > 1) {
        await route.fulfill({
          json: {
            schemaVersion: 1,
            requestId: own.id,
            version: own.version + 2,
            interestRevision: interest.interestRevision + 2,
            state: "dropped",
            keepingPolicy: "temporary",
          },
        });
        return;
      }
      // The request moved on meanwhile: a reminder was answered elsewhere.
      await rereadAs(page, series.id, (detail) => ({
        ...detail,
        requests: detail.requests.map((request) =>
          request.id === own.id
            ? {
                ...request,
                version: own.version + 1,
                interestRevision: interest.interestRevision + 1,
              }
            : request,
        ),
      }));
      await route.fulfill(refusal("version_conflict"));
    });

    const header = page.getByRole("main").locator("header");
    const following = header.getByRole("button", { name: "Following" });
    await following.click();
    await header.getByRole("button", { name: /^Stop following/u }).click();
    await expect(
      page.getByText(
        "Your request changed before Media got that, so you still follow this. The page now shows the request as it stands; choose Stop following again if you still want to.",
      ),
    ).toBeVisible();
    // Read again without being asked, and nothing left to acknowledge.
    expect(reads()).toBeGreaterThan(0);
    await expect(
      page.getByRole("button", { name: "Review latest details" }),
    ).toHaveCount(0);
    await expect(following).toBeEnabled();

    await following.click();
    await header.getByRole("button", { name: /^Stop following/u }).click();
    await expect(page.getByText("You no longer follow this.")).toBeVisible();
    expect(z.array(RequestInterestCommandSchema).parse(sent)).toEqual([
      drop,
      {
        ...drop,
        expectedVersion: own.version + 1,
        expectedInterestRevision: interest.interestRevision + 1,
      },
    ]);
  });

  test("a request that came to keep the title meanwhile says what stands in the way", async ({
    page,
  }) => {
    await open(page, "member", mediaPath(series.id));
    await allowWrites(page);
    await page.route(INTEREST, async (route) => {
      await rereadAs(page, series.id, (detail) => ({
        ...detail,
        policy: "keep",
        requests: detail.requests.map((request) => ({
          ...request,
          keepingPolicy: "keep",
        })),
      }));
      await route.fulfill(refusal("keep_protected"));
    });
    const header = page.getByRole("main").locator("header");
    const following = header.getByRole("button", { name: "Following" });
    await following.click();
    await header.getByRole("button", { name: /^Stop following/u }).click();
    await expect(
      page.getByText(
        "Your request keeps this for good, so you still follow it. Only the owner can change how long it is kept.",
      ),
    ).toBeVisible();
    // The page as read again: the way out is now the request's withdrawal,
    // and the section below says why.
    await following.click();
    await expect(
      header.getByRole("button", { name: /^Stop following/u }),
    ).toHaveCount(0);
    await expect(
      header.getByRole("button", { name: /^Cancel request/u }),
    ).toBeVisible();
    await expect(household(page)).toContainText(
      "For good, because your request asks for that",
    );
  });

  test("an outcome Media does not know is sent again exactly as it was", async ({
    page,
  }) => {
    await open(page, "member", mediaPath(series.id));
    await allowWrites(page);
    const sent: { key: string | undefined; body: unknown }[] = [];
    await page.route(INTEREST, async (route) => {
      sent.push({
        key: route.request().headers()["idempotency-key"],
        body: route.request().postDataJSON(),
      });
      await (sent.length === 1
        ? route.fulfill({
            status: 502,
            json: { error: { code: "bad_gateway", message: "No answer." } },
          })
        : route.fulfill({
            json: {
              schemaVersion: 1,
              requestId: own.id,
              version: own.version + 1,
              interestRevision: interest.interestRevision + 1,
              state: "dropped",
              keepingPolicy: "temporary",
            },
          }));
    });
    const header = page.getByRole("main").locator("header");
    const following = header.getByRole("button", { name: "Following" });
    await following.click();
    await header.getByRole("button", { name: /^Stop following/u }).click();
    await expect(
      page.getByText(/Media does not know whether that went through/u),
    ).toBeVisible();
    // Nothing else may start until the same command has been sent again.
    await expect(following).toBeDisabled();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText("You no longer follow this.")).toBeVisible();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    expect(sent[0]?.key).toMatch(/\S/u);
    expect(sent[0]?.body).toEqual(drop);
  });

  test("a season asked for by itself is let go the same way", async ({
    page,
  }) => {
    // The member asked for this one season of Andor, not for the series.
    const season = seasonId(titleNamed("Andor"), 2);
    await open(page, "member", mediaPath(season));
    await allowWrites(page);
    const paths: string[] = [];
    await page.route(INTEREST, async (route) => {
      paths.push(new URL(route.request().url()).pathname);
      await route.fulfill(refusal("version_conflict"));
    });
    const header = page.getByRole("main").locator("header");
    await header.getByRole("button", { name: "Following" }).click();
    await header.getByRole("button", { name: /^Stop following/u }).click();
    await expect(page.getByText(/Your request changed/u)).toBeVisible();
    expect(paths).toEqual([
      `/api/v1/request-interests/${requestId(4)}/commands`,
    ]);
  });
});
