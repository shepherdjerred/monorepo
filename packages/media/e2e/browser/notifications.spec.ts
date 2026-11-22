import { expect, type Locator, type Page, type Route } from "@playwright/test";
import { NotificationListSchema } from "#shared/api.ts";
import {
  address,
  inScenario,
  openAs,
  horizontalOverflow,
  settle,
  test,
  violationDetails,
  allowWrites,
} from "./support.ts";

/*
 * Notifications: one entry per event however many channels it went out on,
 * newest first, with the unread reminder and its mark-as-read, the delivery
 * details an entry keeps one step away, and the count on the bell.
 */

const LIST_READS = /\/api\/v1\/notifications$/u;

/** The entries themselves, not the lists inside them. */
const entries = (page: Page) =>
  page.getByRole("list", { name: "Notifications" }).locator("> li");
const entry = (page: Page, title: string | RegExp) =>
  entries(page).filter({
    has: page.getByRole("heading", { level: 2, name: title }),
  });
const channels = (row: Locator) =>
  row.getByRole("list", { name: "Sent by" }).getByRole("listitem");
const bell = (page: Page) =>
  page.getByRole("link", { name: /^Notifications/u });

test("a member sees one entry per event, with its channels as badges", async ({
  page,
}) => {
  await openAs(page, "member", "/notifications");
  await settle(page);
  await expect(page).toHaveTitle("Notifications · Media");
  await expect(entries(page)).toHaveCount(15);

  // Two channels, one entry.
  const ready = entry(page, "Dune: Part Two is ready to watch");
  await expect(ready).toHaveCount(1);
  await expect(channels(ready)).toHaveText([
    "Email: delivered",
    "Discord: sent",
  ]);
  await expect(ready.getByRole("heading").getByRole("link")).toHaveAttribute(
    "href",
    /^\/media\/[\da-f-]+$/u,
  );
  await expect(ready.locator("img")).toHaveAttribute(
    "srcset",
    /\/api\/v1\/artwork\/w185\//u,
  );
  await expect(ready.locator("time")).toHaveAttribute(
    "datetime",
    /^\d{4}-\d\d-\d\dT/u,
  );
  // A second event about the same title is its own entry.
  await expect(
    entry(page, "A better version of Dune: Part Two arrived"),
  ).toHaveCount(1);

  // Newest first, and the unread reminder says so in words.
  const first = entries(page).first();
  await expect(first.getByRole("heading")).toHaveText(
    "Unread The Expanse is leaving soon",
  );
  await expect(first).toHaveAttribute("data-unread", "true");
  await expect(channels(first)).toHaveText([
    "In Media: not read yet",
    "Email: delivered",
  ]);
  await expect(
    first.getByRole("button", { name: "Mark as read" }),
  ).toBeVisible();
  await expect(first.getByRole("link", { name: "Mine" })).toHaveAttribute(
    "href",
    "/library/mine",
  );
  // The same reminder once read.
  const read = entry(page, "Moonlight is leaving soon");
  await expect(read).toHaveAttribute("data-unread", "false");
  await expect(channels(read)).toHaveText([
    "In Media: read",
    "Email: delivered",
  ]);
  await expect(read.getByRole("button", { name: "Mark as read" })).toHaveCount(
    0,
  );

  // An episode is named as one; an event with no title is a plain sentence.
  await expect(
    entry(page, /^Episode \d+ of .+ is ready to watch$/u),
  ).toHaveCount(2);
  await expect(
    entry(page, "Episode 7 of The Bear is ready to watch"),
  ).toHaveCount(1);
  for (const title of [
    "A title was removed for good",
    "Confirm your email address",
  ]) {
    const plain = entry(page, title);
    await expect(plain).toHaveCount(1);
    await expect(plain.getByRole("heading").getByRole("link")).toHaveCount(0);
    await expect(plain.locator("img")).toHaveCount(0);
  }

  // A "still watching?" check leads to its request in the Library.
  await expect(
    entry(page, "Still watching The Bear?").getByRole("link", {
      name: "Answer under Mine in the Library",
    }),
  ).toHaveAttribute("href", /^\/library\/mine\?interest=[\da-f-]+$/u);

  // Nothing an owner would see, and no contract value.
  await expect(page.locator("#main")).not.toContainText(
    /paused its automation|needs the owner|Recorded reason|Provider receipt/u,
  );
  await expect(page.locator("#main")).not.toContainText(/[a-z]_[a-z]/u);
  expect(await horizontalOverflow(page)).toBe(0);
  expect(await violationDetails(page)).toEqual([]);
});

test("a delivery that needs its reader opens its details; the rest keep theirs one step away", async ({
  page,
}) => {
  await openAs(page, "member", "/notifications");
  await settle(page);

  const bounced = entry(page, "Still watching Slow Horses?");
  await expect(channels(bounced)).toHaveText(["Email: bounced"]);
  await expect(bounced.getByRole("alert")).toContainText(
    "The mail service reported that this bounced.",
  );
  await expect(
    bounced.getByRole("button", { name: "Send again" }),
  ).toBeVisible();
  await expect(
    bounced.getByRole("button", { name: "Check delivery" }),
  ).toBeVisible();

  // Refused by the provider, with attempts left.
  const refused = entry(page, "Media could not get Anora");
  await expect(channels(refused)).toHaveText(["Email: not sent"]);
  await expect(refused).toContainText("This message could not be sent.");
  await expect(
    refused.getByRole("button", { name: "Send again" }),
  ).toBeVisible();
  // Out of attempts: nothing to send again.
  const spent = entry(page, /^Episode \d+ of .+ is ready to watch$/u).filter({
    hasText: "Email: not sent",
  });
  await expect(spent.getByRole("button", { name: "Send again" })).toHaveCount(
    0,
  );

  // A delivery that simply arrived keeps its details closed until asked.
  const fine = entry(page, "Subtitles for Parasite are ready");
  const check = fine.getByRole("button", { name: "Check delivery" });
  await expect(check).toBeHidden();
  await fine.getByText("Delivery details").click();
  await expect(check).toBeVisible();
  await expect(fine).toContainText("Email: sent");
});

test("the owner also sees the system's own alerts, and what a member is spared", async ({
  page,
}) => {
  await openAs(page, "owner", "/notifications");
  await settle(page);
  await expect(entries(page)).toHaveCount(19);

  const alerts = entry(page, "Media paused its automation");
  await expect(alerts).toHaveCount(2);
  await expect(alerts.first()).toContainText(
    "A legacy media manager resumed or its writer authority could not be confirmed.",
  );
  await expect(
    alerts.first().getByRole("link", { name: "Review recovery protections" }),
  ).toHaveAttribute("href", "/recovery");
  // An alert about an earlier state is history: it takes no commands.
  const earlier = alerts.filter({
    hasText: "This alert describes an earlier state.",
  });
  await earlier.getByText("Delivery details").click();
  await expect(earlier.getByRole("button")).toHaveCount(0);

  // Unconfirmed delivery: the owner can give the provider's receipt.
  const intervention = entry(page, "Severance needs the owner");
  await expect(channels(intervention)).toHaveText(["Email: not confirmed"]);
  await expect(intervention.getByLabel("Provider receipt")).toBeVisible();
  await expect(
    intervention.getByRole("button", { name: "Check delivery" }),
  ).toBeVisible();

  // The household's shared announcement names no title.
  const shared = entry(page, "Something new is ready to watch");
  await expect(channels(shared)).toHaveText([
    "Household Discord channel: sent",
  ]);
  await expect(shared.getByRole("heading").getByRole("link")).toHaveCount(0);

  await expect(entry(page, "Media could not get Anora")).toContainText(
    "Recorded reason: provider rejected.",
  );
  expect(await horizontalOverflow(page)).toBe(0);
  expect(await violationDetails(page)).toEqual([]);
});

test("the bell counts what is unread, and marking a reminder read clears it", async ({
  page,
}) => {
  await openAs(page, "member", "/library");
  await allowWrites(page);
  // The count is on every page, from the same read the list uses.
  await expect(bell(page)).toHaveAccessibleName("Notifications, 1 unread");
  await expect(bell(page)).toHaveText("1");
  await bell(page).click();
  await expect.poll(() => address(page)).toBe("/notifications");
  await settle(page);
  await expect(bell(page)).toHaveAttribute("aria-current", "page");

  // The fixture API refuses writes, so the test answers this one itself and
  // then serves the list as the server would after it.
  const sent: { url: string; body: unknown; key: string | undefined }[] = [];
  await page.route(/\/api\/v1\/notifications\/[^/]+\/read$/u, async (route) => {
    const request = route.request();
    sent.push({
      url: request.url(),
      body: request.postDataJSON() as unknown,
      key: request.headers()["idempotency-key"],
    });
    await page.route(LIST_READS, async (list) => {
      const answer = await list.fetch();
      const rows = NotificationListSchema.parse(await answer.json());
      await list.fulfill({
        json: rows.map((row) =>
          row.channel === "in_app" && row.state === "pending"
            ? { ...row, state: "accepted", providerStatus: "viewed" }
            : row,
        ),
      });
    });
    await route.fulfill({ json: {} });
  });

  const reminder = entries(page).first();
  const unread = reminder.locator('[aria-label="Sent by"] li').first();
  await expect(unread).toHaveText("In Media: not read yet");
  await reminder.getByRole("button", { name: "Mark as read" }).click();
  await expect(unread).toHaveText("In Media: read");
  await expect(reminder).toHaveAttribute("data-unread", "false");
  await expect(
    reminder.getByRole("button", { name: "Mark as read" }),
  ).toHaveCount(0);
  await expect(reminder.getByRole("heading")).toHaveText(
    "The Expanse is leaving soon",
  );
  await expect(bell(page)).toHaveAccessibleName("Notifications");
  await expect(bell(page)).toHaveText("");

  expect(sent).toHaveLength(1);
  expect(sent[0]?.body).toEqual({ expectedVersion: expect.any(Number) });
  expect(sent[0]?.key).toMatch(/^[\da-f-]{36}$/u);
});

test("the list says when it may have been cut short, and only then", async ({
  page,
}) => {
  let wanted = 100;
  await page.route(LIST_READS, async (route) => {
    const answer = await route.fetch();
    const [first] = NotificationListSchema.parse(await answer.json());
    if (first === undefined) throw new Error("The fixture has no notification");
    // As many deliveries as asked for, each its own event.
    await route.fulfill({
      json: Array.from({ length: wanted }, (_, index) => ({
        ...first,
        id: `delivery-${String(index)}`,
        channel: "email",
        state: "accepted",
        event: { ...first.event, id: `event-${String(index)}` },
      })),
    });
  });
  await openAs(page, "member", "/notifications");
  await settle(page);
  await expect(entries(page)).toHaveCount(100);
  await expect(
    page.getByText("Earlier notifications are not listed."),
  ).toBeVisible();

  wanted = 99;
  await page.reload();
  await settle(page);
  await expect(entries(page)).toHaveCount(99);
  await expect(
    page.getByText("Earlier notifications are not listed."),
  ).toHaveCount(0);
});

test("a household that has been told nothing is pointed at its settings", async ({
  page,
}) => {
  await inScenario(page, "new-household");
  await openAs(page, "member", "/notifications");
  await settle(page);
  await expect(
    page.getByRole("heading", { name: "Nothing to tell you yet" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Choose how Media reaches you" }),
  ).toHaveAttribute("href", "/notifications/settings");
  await expect(bell(page)).toHaveAccessibleName("Notifications");
  expect(await violationDetails(page)).toEqual([]);
});

test("the list takes its room while it loads, then says when it could not", async ({
  page,
}) => {
  const held: Route[] = [];
  await page.route(LIST_READS, (route) => {
    held.push(route);
  });
  await openAs(page, "member", "/notifications");
  await expect(page.locator("#main").getByRole("status")).toContainText(
    "Loading notifications",
  );
  // The bell waits for the same read: no count yet, and no guess.
  await expect(bell(page)).toHaveAccessibleName("Notifications");
  await Promise.all(
    held.map(async (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "internal", message: "Internal error" },
        }),
      }),
    ),
  );
  await page.unroute(LIST_READS);
  await expect(page.getByRole("alert")).toContainText(
    "Your notifications did not load",
  );
  expect(await violationDetails(page)).toEqual([]);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(entries(page)).toHaveCount(15);
});
