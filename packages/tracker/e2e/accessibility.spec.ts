import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { z } from "zod";
import {
  createIssue,
  removeScratchIssues,
  scratchTag,
  scratchTeam,
} from "./data-helpers.ts";

const forumActor = {
  key: "codex:a11y-peer",
  name: "Accessibility Peer",
  kind: "agent",
  metadata: { harness: "playwright" },
};
const ForumCreatedSchema = z.object({
  result: z.object({
    data: z.object({
      id: z.string(),
      identifier: z.string(),
      revision: z.number(),
    }),
  }),
});
const ForumReplyCreatedSchema = z.object({
  result: z.object({ data: z.object({ id: z.string() }) }),
});
const openScratchNotices: { id: string; revision: number }[] = [];

async function cleanupScratchNotices(request: APIRequestContext) {
  for (const notice of openScratchNotices.splice(0)) {
    await request.post("/trpc/forum.resolve", {
      data: {
        actor: forumActor,
        id: notice.id,
        expectedRevision: notice.revision,
        note: "Accessibility test cleanup.",
      },
    });
  }
}

const surfaces: { name: string; open: (page: Page) => Promise<void> }[] = [
  {
    name: "issue list",
    open: async (page) => {
      await page.goto("/issues");
      await expect(page.getByRole("list", { name: "Issues" })).toBeVisible();
    },
  },
  {
    name: "board",
    open: async (page) => {
      await page.goto("/board");
      await expect(page.locator(".board-card").first()).toBeVisible();
    },
  },
  {
    name: "issue detail",
    open: async (page) => {
      await page.goto("/issues/AI-1");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Acceptance", exact: true }),
      ).toBeVisible();
    },
  },
  {
    name: "issue detail with a toast",
    open: async (page) => {
      await page.goto("/issues/AI-1");
      await page.locator("#property-priority").selectOption("Low");
      await expect(page.locator(".toast")).toContainText("priority set to Low");
      await expect(
        page.getByRole("heading", { name: "Acceptance", exact: true }),
      ).toBeVisible();
    },
  },
  {
    name: "command palette",
    open: async (page) => {
      await page.goto("/issues");
      await expect(page.getByRole("list", { name: "Issues" })).toBeVisible();
      await page.keyboard.press("ControlOrMeta+k");
      await page
        .getByRole("combobox", { name: "Search issues and commands" })
        .fill("worker");
      await expect(
        page.getByRole("option", { name: /Investigate worker restart/u }),
      ).toBeVisible();
    },
  },
  {
    name: "an open status picker on a row",
    open: async (page) => {
      await page.goto("/issues");
      await page.locator('[data-picker="state"]').first().click();
      await expect(
        page.getByRole("option", { name: "Backlog" }).first(),
      ).toBeVisible();
    },
  },
  {
    name: "the assignee picker",
    open: async (page) => {
      await page.goto("/issues");
      await page.locator('[data-picker="assignee"]').first().click();
      await expect(
        page.getByRole("option", { name: /Assign to me/u }),
      ).toBeVisible();
    },
  },
  {
    name: "the issue context menu",
    open: async (page) => {
      await page.goto("/issues");
      await page
        .locator("a[data-issue-row]")
        .first()
        .click({ button: "right" });
      // An open submenu is left out: Base UI owns its portal through a
      // span[aria-owns] inside the menu, which axe reports as a child the
      // menu role does not allow.
      await expect(
        page.getByRole("menuitem", { name: "Copy ID" }),
      ).toBeVisible();
    },
  },
  {
    name: "the bulk bar",
    open: async (page) => {
      await page.goto("/issues");
      for (const index of [0, 1]) {
        await page
          .locator("a[data-issue-row]")
          .nth(index)
          .click({ button: "right" });
        await page.getByRole("menuitem", { name: "Select" }).click();
      }
      await expect(
        page.getByRole("region", { name: "Selected issues" }),
      ).toContainText("2 selected");
    },
  },
  {
    name: "the filter popover and chips",
    open: async (page) => {
      await page.goto("/issues?state=Todo&label=feature");
      await page.getByRole("button", { name: /^Filter/u }).click();
      await page.getByRole("option", { name: "Status" }).click();
      await expect(page.getByRole("option", { name: "Todo" })).toBeVisible();
    },
  },
  {
    name: "an issue's sub-issues",
    open: async (page) => {
      const tag = scratchTag();
      const parent = await createIssue(page.request, {
        teamKey: scratchTeam,
        title: `Accessible parent ${tag}`,
      });
      for (const title of ["Accessible child", "Another child"]) {
        await createIssue(page.request, {
          teamKey: scratchTeam,
          title: `${title} ${tag}`,
          parentIdentifier: parent,
        });
      }
      await page.goto(`/issues/${parent}`);
      await expect(
        page.getByRole("list", { name: "Sub-issues" }).getByRole("listitem"),
      ).toHaveCount(2);
    },
  },
  {
    name: "the due date picker and its calendar",
    open: async (page) => {
      await page.goto("/issues/AI-1");
      await page.locator("#property-due").click();
      await expect(page.getByRole("grid")).toBeVisible();
    },
  },
  {
    name: "the save view dialog",
    open: async (page) => {
      await page.goto("/issues?priority=1");
      await page.locator("#save-view").click();
      await expect(
        page.getByRole("dialog", { name: "Save view" }),
      ).toBeVisible();
    },
  },
  {
    name: "settings",
    open: async (page) => {
      await page.goto("/settings");
      await expect(
        page.getByRole("heading", { name: "Appearance", exact: true }),
      ).toBeVisible();
    },
  },
  {
    name: "the browser identity dialog",
    open: async (page) => {
      await page.goto("/issues");
      const more = page.getByRole("button", { name: "More", exact: true });
      if (await more.isVisible()) {
        await more.click();
      }
      await page.getByRole("button", { name: /^Acting as /u }).click();
      await expect(
        page.getByRole("dialog", { name: "Browser identity" }),
      ).toBeVisible();
    },
  },
  {
    name: "the settings feedback switches",
    open: async (page) => {
      await page.goto("/settings");
      await expect(
        page.getByRole("heading", { name: "Feedback", exact: true }),
      ).toBeVisible();
      // One switch on and one off, so both states are checked.
      await page.getByRole("switch", { name: "Sounds" }).click();
      await expect(
        page.getByRole("switch", { name: "Sounds" }),
      ).not.toBeChecked();
      await expect(page.getByRole("switch", { name: "Haptics" })).toBeChecked();
    },
  },
  {
    name: "the forum feed with active notices and answered questions",
    open: async (page) => {
      const tag = scratchTag();
      const noticeRes = await page.request.post("/trpc/forum.create", {
        data: {
          actor: forumActor,
          kind: "notice",
          title: `Accessible notice ${tag}`,
          body: "Active coordination notice for contrast verification.",
          scopes: ["ci"],
          exitCondition: "CI returns to green.",
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        },
      });
      expect(noticeRes.ok()).toBe(true);
      const notice = ForumCreatedSchema.parse(await noticeRes.json()).result
        .data;
      openScratchNotices.push({ id: notice.id, revision: notice.revision });

      const questionRes = await page.request.post("/trpc/forum.create", {
        data: {
          actor: forumActor,
          kind: "question",
          title: `Accessible question ${tag}`,
          body: "Does the forum feed pass axe-core?",
          scopes: ["ui"],
        },
      });
      expect(questionRes.ok()).toBe(true);
      const question = ForumCreatedSchema.parse(await questionRes.json()).result
        .data;
      const replyRes = await page.request.post("/trpc/forum.reply", {
        data: {
          actor: forumActor,
          id: question.id,
          body: "Yes, in both light and dark themes.",
        },
      });
      const replyId = ForumReplyCreatedSchema.parse(await replyRes.json())
        .result.data.id;
      await page.request.post("/trpc/forum.acceptReply", {
        data: { actor: forumActor, id: question.id, replyId },
      });

      await page.goto("/forum");
      await expect(
        page.getByRole("heading", { name: "Forum", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: `Accessible notice ${tag}` }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: `Accessible question ${tag}` }),
      ).toBeVisible();
    },
  },
  {
    name: "a forum thread detail with nested replies and reactions",
    open: async (page) => {
      const tag = scratchTag();
      const postRes = await page.request.post("/trpc/forum.create", {
        data: {
          actor: forumActor,
          kind: "question",
          title: `Thread detail ${tag}`,
          body: "Checking nested replies, accepted callout, and reactions.",
          scopes: ["accessibility"],
        },
      });
      expect(postRes.ok()).toBe(true);
      const post = ForumCreatedSchema.parse(await postRes.json()).result.data;
      const rootReplyRes = await page.request.post("/trpc/forum.reply", {
        data: {
          actor: forumActor,
          id: post.id,
          body: "Top-level accepted answer.",
        },
      });
      const rootReplyId = ForumReplyCreatedSchema.parse(
        await rootReplyRes.json(),
      ).result.data.id;
      await page.request.post("/trpc/forum.reply", {
        data: {
          actor: forumActor,
          id: post.id,
          parentReplyId: rootReplyId,
          body: "Nested follow-up verification note.",
        },
      });
      await page.request.post("/trpc/forum.acceptReply", {
        data: { actor: forumActor, id: post.id, replyId: rootReplyId },
      });
      await page.request.post("/trpc/forum.react", {
        data: { actor: forumActor, id: post.id, emoji: "🎉" },
      });

      await page.goto(`/forum/${post.identifier}`);
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: `Thread detail ${tag}`,
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByText("Nested follow-up verification note.", { exact: true }),
      ).toBeVisible();
    },
  },
];

test.afterEach(async ({ request }) => {
  await removeScratchIssues(request);
  await cleanupScratchNotices(request);
});
/**
 * Let opening and closing surfaces finish moving first: half-faded text is
 * a moment of an animation, not a state anyone reads.
 */
async function settle(page: Page) {
  await page.evaluate(async () => {
    await Promise.allSettled(
      globalThis.document
        .getAnimations()
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().iterations !==
            Number.POSITIVE_INFINITY,
        )
        .map(async (animation) => animation.finished),
    );
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  for (const surface of surfaces) {
    test(`${surface.name} has no serious accessibility violations in ${colorScheme}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme });
      await surface.open(page);
      await settle(page);
      const { violations } = await new AxeBuilder({ page }).analyze();
      const blocking = violations
        .filter(({ impact }) => impact === "serious" || impact === "critical")
        .map(({ id, help, nodes }) => ({
          id,
          help,
          targets: nodes.map(({ target }) => target.join(" ")),
        }));
      expect(blocking).toEqual([]);
    });
  }
}
