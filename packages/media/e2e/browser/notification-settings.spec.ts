import { expect, type Page } from "@playwright/test";
import {
  address,
  openAs,
  horizontalOverflow,
  settle,
  test,
  violationDetails,
  allowWrites,
} from "./support.ts";

/*
 * Notification settings, reached from the account menu, and the two pages
 * the server sends people to: the link in a verification email and the
 * return from Discord. The fixture API refuses writes, so each test answers
 * the one write it makes.
 */

type Sent = { method: string; path: string; body: unknown };

/** Answers every write under `/api/v1/notifications/` and records it. */
async function answerWrites(page: Page): Promise<Sent[]> {
  const sent: Sent[] = [];
  await page.route(/\/api\/v1\/notifications\//u, async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fallback();
      return;
    }
    sent.push({
      method: request.method(),
      path: new URL(request.url()).pathname,
      body: request.postDataJSON() as unknown,
    });
    await route.fulfill({ json: {} });
  });
  return sent;
}

test("the account menu leads to the settings: where Media reaches a member and what it sends", async ({
  page,
}) => {
  await openAs(page, "member", "/library");
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("link", { name: "Notification settings" }).click();
  await expect.poll(() => address(page)).toBe("/notifications/settings");
  await expect(
    page.getByRole("heading", { level: 1, name: "Notification settings" }),
  ).toBeFocused();
  await settle(page);
  await expect(page).toHaveTitle("Notification settings · Media");

  // The confirmed address, and Discord not linked yet.
  await expect(page.locator("#main")).toContainText(
    "Media writes to mei@example.com, which you confirmed.",
  );
  await expect(page.getByLabel("Email address")).toHaveValue("mei@example.com");
  await expect(
    page.getByRole("button", { name: "Link Discord" }),
  ).toBeEnabled();

  const by = page.getByRole("group", { name: "Send notifications by" });
  await expect(by.getByRole("checkbox", { name: "Email" })).toBeChecked();
  const discord = by.getByRole("checkbox", { name: "Discord direct message" });
  await expect(discord).toBeDisabled();
  await expect(discord).toHaveAccessibleDescription("Link Discord first.");
  const also = page.getByRole("group", { name: "Also tell me when" });
  await expect(
    also.getByRole("checkbox", {
      name: "A better version of something arrives",
    }),
  ).not.toBeChecked();
  await expect(
    also.getByRole("checkbox", { name: "A removal completes" }),
  ).toBeChecked();
  expect(await horizontalOverflow(page)).toBe(0);
  expect(await violationDetails(page)).toEqual([]);
});

test("saving sends the choices with the version they were read at, and says so", async ({
  page,
}) => {
  const sent = await answerWrites(page);
  await openAs(page, "member", "/notifications/settings");
  await allowWrites(page);
  await settle(page);
  await page
    .getByRole("checkbox", { name: "A better version of something arrives" })
    .check();
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByRole("status")).toHaveText("Preferences saved.");
  expect(sent).toEqual([
    {
      method: "PUT",
      path: "/api/v1/notifications/preferences",
      body: {
        emailEnabled: true,
        discordEnabled: false,
        upgrades: true,
        removalCompleted: true,
        expectedVersion: 4,
      },
    },
  ]);
  // A change after the save is not what is stored, so the word goes.
  await page.getByRole("checkbox", { name: "A removal completes" }).uncheck();
  await expect(page.getByText("Preferences saved.")).toHaveCount(0);
});

test("an address is confirmed by an email, and the owner can unlink Discord", async ({
  page,
}) => {
  const sent = await answerWrites(page);
  await openAs(page, "owner", "/notifications/settings");
  await allowWrites(page);
  await settle(page);
  await expect(page.locator("#main")).toContainText(
    "Your Discord account is linked.",
  );
  await expect(
    page.getByRole("checkbox", { name: "Discord direct message" }),
  ).toBeChecked();

  await page.getByLabel("Email address").fill("robin@example.com");
  await page.getByRole("button", { name: "Send verification email" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Verification email sent. Follow the link in it to confirm the address.",
  );
  await page.getByRole("button", { name: "Unlink Discord" }).click();
  await expect.poll(() => sent.length).toBe(2);
  expect(sent).toEqual([
    {
      method: "POST",
      path: "/api/v1/notifications/email",
      body: { email: "robin@example.com" },
    },
    { method: "DELETE", path: "/api/v1/notifications/discord", body: {} },
  ]);
  expect(await violationDetails(page)).toEqual([]);
});

test("the settings take their room while they load, then say when they could not", async ({
  page,
}) => {
  const reads = /\/api\/v1\/notifications\/preferences$/u;
  await page.route(reads, (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "internal", message: "Internal error" },
      }),
    }),
  );
  await openAs(page, "member", "/notifications/settings");
  await expect(page.locator("#main").getByRole("alert")).toContainText(
    "Your notification settings did not load",
  );
  expect(await violationDetails(page)).toEqual([]);
  await page.unroute(reads);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByLabel("Email address")).toBeVisible();
});

/*
 * The server writes these addresses into a verification email and gives
 * Discord the second as its return address, so both must keep working.
 */
for (const { name, path, heading, action, done, write } of [
  {
    name: "a verification email's link",
    path: "/notifications/email#verify=token-from-the-email",
    heading: "Confirm your email address",
    action: "Confirm email address",
    done: "Email address confirmed.",
    write: {
      method: "POST",
      path: "/api/v1/notifications/email/verify",
      body: { token: "token-from-the-email" },
    },
  },
  {
    name: "an older verification link on the notifications page",
    path: "/notifications#verify=token-from-the-email",
    heading: "Confirm your email address",
    action: "Confirm email address",
    done: "Email address confirmed.",
    write: {
      method: "POST",
      path: "/api/v1/notifications/email/verify",
      body: { token: "token-from-the-email" },
    },
  },
  {
    name: "the return from Discord",
    path: "/notifications/discord?code=abc&state=def&iss=https%3A%2F%2Fdiscord.com",
    heading: "Connect your Discord account",
    action: "Connect Discord",
    done: "Discord connected.",
    write: {
      method: "POST",
      path: "/api/v1/notifications/discord/complete",
      body: { code: "abc", state: "def", issuer: "https://discord.com" },
    },
  },
] as const) {
  test(`${name} waits for the reader, then confirms and leads to the settings`, async ({
    page,
  }) => {
    const sent = await answerWrites(page);
    await openAs(page, "member", path);
    await allowWrites(page);
    await expect(
      page.getByRole("heading", { level: 1, name: heading }),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");
    // Opening the link sends nothing.
    expect(sent).toEqual([]);
    expect(await violationDetails(page)).toEqual([]);

    await page.getByRole("button", { name: action }).click();
    await expect(page.locator("#main").getByRole("status")).toContainText(done);
    expect(sent).toEqual([write]);
    await page
      .locator("#main")
      .getByRole("link", { name: "Notification settings" })
      .click();
    await expect.poll(() => address(page)).toBe("/notifications/settings");
  });
}
