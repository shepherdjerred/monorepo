import { expect, test } from "@playwright/test";
import {
  promotionFixture,
  redditOutreachFixture,
} from "#test-fixtures/promotion";

test("shows verified outreach replies and safely expands recorded and missing audit details", async ({
  page,
}) => {
  await page.goto("/promotion");
  const outreach = page.getByRole("region", {
    name: "Reddit outreach",
    exact: true,
  });
  await expect(outreach.getByText("1,282", { exact: true })).toBeVisible();
  await expect(
    outreach.getByText("Reddit challenge", { exact: true }),
  ).toBeVisible();
  await expect(
    outreach.getByText("Cooldown until", { exact: true }),
  ).toBeVisible();
  const rows = outreach.getByRole("row");
  await expect(rows).toHaveCount(5);
  const failed = rows.filter({ hasText: "Failed" });
  await failed.getByText("Run details", { exact: true }).click();
  await expect(
    failed.getByText("Failure category · Temporal workflow"),
  ).toBeVisible();
  await expect(failed.getByText("Run counts unavailable")).toBeVisible();
  const limited = rows.filter({ hasText: "Decisions API rate limit" });
  await expect(
    limited.getByText("Deferred until", { exact: false }),
  ).toBeVisible();
  const verified = rows.filter({ hasText: "1 verified" });
  await verified.getByText("Run details", { exact: true }).click();
  await expect(verified.getByText("Fit score missed threshold")).toBeVisible();
  await expect(
    verified.getByRole("link", { name: "Verified Reddit reply 1" }),
  ).toHaveAttribute(
    "href",
    /https:\/\/www\.reddit\.com\/r\/MinecraftServer\/comments\/[^/]+\/[^/]+\/[^/]+\//u,
  );
  const legacy = rows.filter({ hasText: "Nov 20" });
  await legacy.getByText("Run details", { exact: true }).click();
  await expect(
    legacy.getByText("Breakdown unavailable for this run."),
  ).toBeVisible();
});

test("outreach stacks on a phone and keeps the existing promotion summary", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/promotion");
  const outreach = page.getByRole("region", {
    name: "Reddit outreach",
    exact: true,
  });
  const verified = outreach.getByRole("row").filter({ hasText: "1 verified" });
  await verified.getByText("Run details", { exact: true }).click();
  await expect(
    verified.getByRole("link", { name: "Verified Reddit reply 1" }),
  ).toBeVisible();
  const scrollWidth = await outreach.evaluate((region) => region.scrollWidth);
  const box = await outreach.boundingBox();
  expect(scrollWidth).toBeLessThanOrEqual(375);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(375);
  await expect(
    page.getByRole("heading", { name: "No run recorded yet" }),
  ).toBeVisible();
});

test("older producers, unavailable outreach, and a genuine count of zero stay distinct", async ({
  page,
}) => {
  let response: unknown = { ...promotionFixture, redditOutreach: undefined };
  await page.route("/api/v1/promotion", (route) =>
    route.fulfill({ json: response }),
  );
  await page.goto("/promotion");
  const outreach = page.getByRole("region", {
    name: "Reddit outreach",
    exact: true,
  });
  await expect(
    outreach.getByText("Outreach status unavailable."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "No run recorded yet" }),
  ).toBeVisible();

  response = { ...promotionFixture, redditOutreach: { status: "unavailable" } };
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(
    outreach.getByText("Outreach status unavailable."),
  ).toBeVisible();

  response = {
    ...promotionFixture,
    redditOutreach: {
      ...redditOutreachFixture,
      schedule: { state: "paused", lastRunAt: null, nextRunAt: null },
      publishing: "disabled",
      account: { hold: null, retryAt: null },
      today: {
        ...redditOutreachFixture.today,
        inspected: 0,
        assessed: 0,
        cached: 0,
        draftsPrepared: 0,
        verifiedReplies: 0,
        unresolvedReplies: 0,
        remainingSlots: 10,
      },
      runs: [],
    },
  };
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(outreach.getByText("Paused", { exact: true })).toBeVisible();
  await expect(outreach.getByText("Disabled", { exact: true })).toBeVisible();
  await expect(outreach.getByText("0", { exact: true })).toHaveCount(5);
  await expect(
    outreach.getByText("No production sweeps recorded today or yesterday."),
  ).toBeVisible();
});
