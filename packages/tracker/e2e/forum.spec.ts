import { expect, test } from "@playwright/test";
import { z } from "zod";

const Posted = z.object({
  result: z.object({
    data: z.object({ id: z.string(), revision: z.number() }),
  }),
});
const actor = {
  key: "codex:forum-peer",
  name: "Forum Peer",
  kind: "agent",
  metadata: { harness: "codex", sessionId: "forum-peer" },
};

test("an open feed refreshes when a notice expires", async ({
  page,
  request,
}) => {
  const title = `Timed ${crypto.randomUUID()}`;
  const response = await request.post("/trpc/forum.create", {
    data: {
      actor,
      kind: "notice",
      title,
      body: "Temporary coordination",
      exitCondition: "Check the underlying work before resolving",
      expiresAt: new Date(Date.now() + 3500).toISOString(),
    },
  });
  expect(response.ok()).toBe(true);
  await page.goto("/forum");
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await expect(page.getByText(title, { exact: true })).not.toBeVisible({
    timeout: 8000,
  });
  await page
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("expired");
  await expect(page.getByText(title, { exact: true })).toBeVisible();
});

test("notices coordinate across sessions and retain resolution evidence", async ({
  page,
  request,
}) => {
  const title = `Main recovery ${crypto.randomUUID()}`;
  await page.goto("/forum");
  await expect(
    page.getByRole("heading", { name: "Forum", exact: true }),
  ).toBeVisible();
  const response = await request.post("/trpc/forum.create", {
    data: {
      actor,
      kind: "notice",
      title,
      body: "I am repairing the failure introduced by my change.",
      scopes: ["main"],
      exitCondition: "Main verification passes.",
    },
  });
  expect(response.ok()).toBe(true);
  const { id } = Posted.parse(await response.json()).result.data;
  const card = page.locator("details", {
    has: page.getByText(title, { exact: true }),
  });
  await expect(card).toBeVisible();
  await card.locator("summary").click();
  await expect(
    card.getByText("codex:forum-peer", { exact: true }),
  ).toBeVisible();
  await card
    .getByLabel("Reply text")
    .fill("I will leave main recovery with you.");
  await card.getByRole("button", { name: "Post reply", exact: true }).click();
  await expect(
    card.getByText("I will leave main recovery with you.", { exact: true }),
  ).toBeVisible();
  await page.goto(`/forum?post=${id}`);
  const thread = page.getByRole("region", { name: "Linked thread" });
  await thread.getByRole("button", { name: "Resolve", exact: true }).click();
  await thread
    .getByLabel("Resolution evidence")
    .fill("Main verification passed for the repaired commit.");
  await thread
    .getByRole("button", { name: "Resolve post", exact: true })
    .click();
  await expect(
    thread.getByText("Main verification passed for the repaired commit.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    thread.getByRole("button", { name: "Reopen", exact: true }),
  ).toBeVisible();
});

test("creates discussions and shows expired notices in history", async ({
  page,
  request,
}) => {
  const title = `Question ${crypto.randomUUID()}`;
  await page.goto("/forum");
  await page.getByRole("button", { name: "New post", exact: true }).click();
  const form = page.getByRole("form", { name: "New forum post" });
  await form.getByLabel("Post type").selectOption("discussion");
  await form.getByLabel("Title", { exact: true }).fill(title);
  await form
    .getByLabel("Body", { exact: true })
    .fill("What evidence establishes a recovered build?");
  await form.getByRole("button", { name: "Save post", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Linked thread" }),
  ).toContainText(title);
  const expired = `Expired ${crypto.randomUUID()}`;
  const response = await request.post("/trpc/forum.create", {
    data: {
      actor,
      kind: "notice",
      title: expired,
      body: "Old maintenance context",
      exitCondition: "Verify the dispatcher resumed",
      expiresAt: "2020-01-01T00:00:00Z",
    },
  });
  expect(response.ok()).toBe(true);
  await page.goto("/forum");
  await expect(page.getByText(expired, { exact: true })).not.toBeVisible();
  await page
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("expired");
  await expect(page.getByText(expired, { exact: true })).toBeVisible();
  await page.getByText(expired, { exact: true }).click();
  await expect(
    page.getByText("Expiration does not confirm cleanup.", { exact: false }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.innerWidth,
    ),
  ).toBe(true);
});
