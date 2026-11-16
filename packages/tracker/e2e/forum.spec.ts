import { expect, test } from "@playwright/test";
import { z } from "zod";
import { removeIssue } from "./data-helpers.ts";

const Posted = z.object({
  result: z.object({
    data: z.object({
      id: z.string(),
      identifier: z.string(),
      revision: z.number(),
    }),
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

test("notices coordinate across sessions, redirect legacy ?post= links, and retain resolution evidence", async ({
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
  const { id, identifier } = Posted.parse(await response.json()).result.data;

  const link = page.getByRole("link", { name: title, exact: true });
  await expect(link).toBeVisible();
  await link.click();

  await expect(page).toHaveURL(new RegExp(`/forum/${identifier}$`, "u"));
  await expect(
    page.getByText("codex:forum-peer", { exact: true }),
  ).toBeVisible();

  await page
    .getByLabel("Reply text", { exact: true })
    .fill("I will leave main recovery with you.");
  await page.getByRole("button", { name: "Post reply", exact: true }).click();
  await expect(
    page.getByText("I will leave main recovery with you.", { exact: true }),
  ).toBeVisible();

  await page.goto(`/forum?post=${id}`);
  await expect(page).toHaveURL(new RegExp(`/forum/${identifier}$`, "u"));

  await page.getByRole("button", { name: "Resolve", exact: true }).click();
  await page
    .getByLabel("Resolution evidence", { exact: true })
    .fill("Main verification passed for the repaired commit.");
  await page.getByRole("button", { name: "Resolve post", exact: true }).click();
  await expect(
    page.getByText("Main verification passed for the repaired commit.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reopen", exact: true }),
  ).toBeVisible();
});

test("creates discussions and shows expired notices in history without horizontal overflow", async ({
  page,
  request,
}) => {
  const title = `Discussion ${crypto.randomUUID()}`;
  await page.goto("/forum");
  await page.getByRole("button", { name: "New post", exact: true }).click();
  const form = page.getByRole("form", { name: "New forum post" });
  await form.getByLabel("Post type").selectOption("discussion");
  await form.getByLabel("Title", { exact: true }).fill(title);
  await form
    .getByLabel("Body", { exact: true })
    .fill("What evidence establishes a recovered build?");
  await form.getByRole("button", { name: "Save post", exact: true }).click();

  await expect(page).toHaveURL(/\/forum\/FM-\d+$/u);
  await expect(
    page.getByRole("heading", { level: 1, name: title, exact: true }),
  ).toBeVisible();

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
  await page.getByRole("link", { name: expired, exact: true }).click();
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

test("supports two-level reply threading and parent tombstone deletion", async ({
  page,
  request,
}) => {
  const title = `Threading ${crypto.randomUUID()}`;
  const created = await request.post("/trpc/forum.create", {
    data: {
      actor,
      kind: "discussion",
      title,
      body: "Testing nested replies and tombstones.",
    },
  });
  expect(created.ok()).toBe(true);
  const { identifier } = Posted.parse(await created.json()).result.data;

  await page.goto(`/forum/${identifier}`);
  await page
    .getByLabel("Reply text", { exact: true })
    .fill("Top-level root reply");
  await page.getByRole("button", { name: "Post reply", exact: true }).click();
  await expect(
    page.getByText("Top-level root reply", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await page
    .getByLabel("Nested reply", { exact: true })
    .fill("Nested child reply");
  await page
    .getByRole("button", { name: "Post sub-reply", exact: true })
    .click();
  await expect(
    page.getByText("Nested child reply", { exact: true }),
  ).toBeVisible();

  const parentCard = page
    .locator(".forum-reply-card")
    .filter({ hasText: "Top-level root reply" });
  await parentCard.getByRole("button", { name: "Delete", exact: true }).click();

  await expect(
    page.getByText("[Reply deleted]", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Top-level root reply", { exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByText("Nested child reply", { exact: true }),
  ).toBeVisible();
});

test("marks accepted answers on question threads and filters by Answered status", async ({
  page,
  request,
}) => {
  const title = `Question ${crypto.randomUUID()}`;
  const created = await request.post("/trpc/forum.create", {
    data: {
      actor,
      kind: "question",
      title,
      body: "How do we verify the new forum router?",
    },
  });
  expect(created.ok()).toBe(true);
  const { identifier } = Posted.parse(await created.json()).result.data;

  await page.goto(`/forum/${identifier}`);
  await page
    .getByLabel("Reply text", { exact: true })
    .fill("Run both Vitest and Playwright E2E suites.");
  await page.getByRole("button", { name: "Post reply", exact: true }).click();

  await page
    .getByRole("button", { name: "Accept answer", exact: true })
    .click();
  await expect(page.locator(".forum-callout-accepted")).toContainText(
    "Accepted answer",
  );
  await expect(
    page.getByRole("link", { name: "Jump to answer", exact: true }),
  ).toBeVisible();

  await page.goto("/forum");
  await page
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("answered");
  const row = page.locator(".forum-row", {
    has: page.getByRole("link", { name: title, exact: true }),
  });
  await expect(row).toBeVisible();
  await expect(row).toContainText("✓ Answered");
});

test("claims and hands off notice ownership with post upvote and emoji reactions", async ({
  page,
  request,
}) => {
  const title = `Coordination ${crypto.randomUUID()}`;
  const created = await request.post("/trpc/forum.create", {
    data: {
      actor,
      kind: "notice",
      title,
      body: "Coordinating cluster rollout.",
      scopes: ["cluster"],
      exitCondition: "ArgoCD reaches Healthy.",
    },
  });
  expect(created.ok()).toBe(true);
  const { id, identifier, revision } = Posted.parse(await created.json()).result
    .data;

  try {
    await page.goto(`/forum/${identifier}`);
    const rail = page.getByRole("complementary", { name: "Thread properties" });
    await expect(rail).toContainText("Unclaimed");

    await rail.getByRole("button", { name: "Claim", exact: true }).click();
    await expect(rail).not.toContainText("Unclaimed");

    await rail.getByRole("button", { name: "Handoff…", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Handoff notice" });
    await dialog.getByLabel("Target owner").selectOption("codex:forum-peer");
    await dialog.getByLabel("Handoff note").fill("Handing back to Forum Peer.");
    await dialog
      .getByRole("button", { name: "Save handoff", exact: true })
      .click();
    await expect(rail).toContainText("Forum Peer");

    const upvote = page
      .locator(".forum-engagement-bar")
      .getByRole("button", { name: /^Upvote/u });
    await upvote.click();
    await expect(upvote).toHaveAttribute("aria-pressed", "true");
    await expect(upvote).toContainText("1");

    await page
      .locator(".forum-engagement-bar")
      .getByRole("button", { name: "+ React", exact: true })
      .click();
    await page
      .getByRole("group", { name: "Choose reaction" })
      .getByRole("button", { name: "🚀", exact: true })
      .click();
    const reactionPill = page
      .locator(".forum-engagement-bar")
      .getByRole("button", { name: /🚀/u });
    await expect(reactionPill).toHaveAttribute("aria-pressed", "true");
    await expect(reactionPill).toContainText("1");
  } finally {
    const latest = await request.get(
      `/trpc/forum.byId?input=${encodeURIComponent(JSON.stringify({ id }))}`,
    );
    const rev = latest.ok()
      ? Posted.parse(await latest.json()).result.data.revision
      : revision;
    await request.post("/trpc/forum.resolve", {
      data: {
        actor,
        id,
        expectedRevision: rev,
        note: "Test completed.",
      },
    });
  }
});

test("promotes a forum thread to an AI issue with bidirectional backlink", async ({
  page,
  request,
}) => {
  const title = `Promote candidate ${crypto.randomUUID()}`;
  const created = await request.post("/trpc/forum.create", {
    data: {
      actor,
      kind: "decision",
      title,
      body: "Standardize structured forum backlinks on issues.",
    },
  });
  expect(created.ok()).toBe(true);
  const { identifier: forumIdentifier } = Posted.parse(await created.json())
    .result.data;

  let promotedIssueIdentifier: string | undefined;
  try {
    await page.goto(`/forum/${forumIdentifier}`);
    const rail = page.getByRole("complementary", { name: "Thread properties" });
    await rail
      .getByRole("button", { name: "Promote to issue…", exact: true })
      .click();

    const dialog = page.getByRole("dialog", { name: "Promote to issue" });
    await expect(dialog.getByLabel("Team")).toHaveValue("AI");
    await expect(dialog.getByLabel("Title")).toHaveValue(title);
    await dialog
      .getByRole("button", { name: "Create issue", exact: true })
      .click();

    await expect(page).toHaveURL(/\/issues\/AI-\d+$/u);
    promotedIssueIdentifier = page.url().split("/issues/")[1];

    await expect(
      page.getByRole("heading", { name: "Forum threads", exact: true }),
    ).toBeVisible();
    const backlink = page.getByRole("link", {
      name: new RegExp(String.raw`${forumIdentifier}\s+${title}`, "u"),
    });
    await expect(backlink).toBeVisible();
    await backlink.click();
    await expect(page).toHaveURL(new RegExp(`/forum/${forumIdentifier}$`, "u"));
  } finally {
    if (promotedIssueIdentifier !== undefined) {
      await removeIssue(request, promotedIssueIdentifier);
    }
  }
});
