import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { z } from "zod";

const actor = {
  key: "human:jerred",
  kind: "human",
  name: "Jerred",
  metadata: { harness: "playwright" },
};
const CreatedSchema = z.object({
  result: z.object({ data: z.object({ identifier: z.string() }) }),
});
const ListedSchema = z.object({
  result: z.object({
    data: z.object({
      items: z.array(z.object({ identifier: z.string() })),
      nextCursor: z.string().nullable(),
    }),
  }),
});

export async function createIssue(
  request: APIRequestContext,
  input: {
    teamKey: string;
    title: string;
    priority?: number;
    stateName?: string;
    labels?: string[];
    parentIdentifier?: string;
    dueDate?: string;
  },
) {
  const response = await request.post("/trpc/issues.create", {
    data: { actor, ...input },
  });
  expect(response.ok()).toBe(true);
  return CreatedSchema.parse(await response.json()).result.data.identifier;
}

const RevisionSchema = z.object({
  result: z.object({ data: z.object({ revision: z.number() }) }),
});

/**
 * Delete an issue a spec made in the shared team, so the specs that read
 * that team's list in its default grouping see it as seeded.
 */
export async function removeIssue(
  request: APIRequestContext,
  identifier: string,
) {
  const input = encodeURIComponent(JSON.stringify({ identifier }));
  const found = await request.get(`/trpc/issues.byIdentifier?input=${input}`);
  const { revision } = RevisionSchema.parse(await found.json()).result.data;
  const response = await request.post("/trpc/issues.delete", {
    data: { actor, identifier, expectedRevision: revision },
  });
  expect(response.ok()).toBe(true);
}

/**
 * Delete every scratch-team issue whose title has `tag`, so a spec leaves
 * the scratch team's list as long as it found it.
 */
async function removeTagged(request: APIRequestContext, tag: string) {
  const input = encodeURIComponent(
    JSON.stringify({ teamKey: scratchTeam, search: tag, limit: 500 }),
  );
  const response = await request.get(`/trpc/issues.list?input=${input}`);
  const { items } = ListedSchema.parse(await response.json()).result.data;
  for (const { identifier } of items) {
    // An edit the page made may still be saving; delete at its revision.
    await expect(() => removeIssue(request, identifier)).toPass();
  }
}

/**
 * Issues these specs create live in a second team, so the lists the other
 * specs read stay as short as they were. The same team holds the long list.
 */
export const scratchTeam = "SJ";
const longCount = 260;

/** Make the scratch team's list at least three pages long; returns its size. */
export async function seedLongList(request: APIRequestContext) {
  let seeded = 0;
  let cursor: string | undefined;
  do {
    const input = encodeURIComponent(
      JSON.stringify({ teamKey: scratchTeam, limit: 500, cursor }),
    );
    const response = await request.get(`/trpc/issues.list?input=${input}`);
    const page = ListedSchema.parse(await response.json()).result.data;
    seeded += page.items.length;
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  for (let index = seeded; index < longCount; index += 1) {
    await createIssue(request, {
      teamKey: scratchTeam,
      // Some titles wrap on a phone, so rows differ in height.
      title:
        index % 7 === 0
          ? `Seeded backlog item ${String(index + 1)} with a title long enough to wrap onto a second line`
          : `Seeded backlog item ${String(index + 1)}`,
    });
  }
  return Math.max(seeded, longCount);
}

/**
 * A word no other issue's title shares, so `?q=` lists only one test's
 * issues: search also matches similar titles, which near timestamps are.
 */
export function uniqueTag() {
  return Array.from(crypto.getRandomValues(new Uint8Array(10)), (byte) =>
    String.fromCodePoint(97 + (byte % 26)),
  ).join("");
}

const madeTags: string[] = [];

/** A unique tag whose issues `removeScratchIssues` deletes after the test. */
export function scratchTag() {
  const tag = uniqueTag();
  madeTags.push(tag);
  return tag;
}

export async function removeScratchIssues(request: APIRequestContext) {
  for (const tag of madeTags.splice(0)) {
    await removeTagged(request, tag);
  }
}

/** Every tRPC call the page makes, as `procedures?input`, decoded. */
export function recordCalls(page: Page) {
  const calls: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/trpc/")) {
      calls.push(
        `${url.pathname.slice("/trpc/".length)}?${url.searchParams.get("input") ?? ""}${request.postData() ?? ""}`,
      );
    }
  });
  return calls;
}

/** Open the issue menu as the platform does: right click, or long press. */
export async function openMenu(
  page: Page,
  identifier: string,
  mobile: boolean,
) {
  const link = page.locator(`a[data-issue-row="${identifier}"]`);
  if (!mobile) {
    await link.click({ button: "right" });
    return;
  }
  const box = await link.boundingBox();
  if (box === null) throw new Error(`${identifier} is not on screen`);
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point],
  });
  await expect(page.getByRole("menu")).toBeVisible();
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await cdp.detach();
}

/** Select rows from their menu, as on a phone where there is no checkbox. */
export async function selectRows(
  page: Page,
  identifiers: readonly string[],
  mobile: boolean,
) {
  for (const identifier of identifiers) {
    await openMenu(page, identifier, mobile);
    await page.getByRole("menuitem", { name: "Select", exact: true }).click();
    await expect(
      page.locator(`li[data-row-issue="${identifier}"]`),
    ).toHaveAttribute("data-selected", "true");
  }
}

const ViewSchema = z.object({
  result: z.object({ data: z.object({ id: z.string(), name: z.string() }) }),
});
const ViewsSchema = z.object({
  result: z.object({
    data: z.array(z.object({ id: z.string(), name: z.string() })),
  }),
});

/** Save a view through the API, as the CLI does. */
export async function createView(
  request: APIRequestContext,
  input: {
    name: string;
    icon?: string;
    params: Record<string, string | string[]>;
    teamKey?: string | null;
  },
) {
  const response = await request.post("/trpc/views.create", {
    data: { actor, icon: "list", ...input },
  });
  expect(response.ok()).toBe(true);
  return ViewSchema.parse(await response.json()).result.data;
}

/** Every saved view, in the shared order. */
export async function listViews(request: APIRequestContext) {
  const response = await request.get("/trpc/views.list");
  return ViewsSchema.parse(await response.json()).result.data;
}

/** Delete the views a spec saved, so the sidebar is as other specs expect. */
export async function removeViews(
  request: APIRequestContext,
  names: readonly string[],
) {
  for (const view of await listViews(request)) {
    if (names.includes(view.name)) {
      const response = await request.post("/trpc/views.delete", {
        data: { actor, id: view.id },
      });
      expect(response.ok()).toBe(true);
    }
  }
}

export async function reorderViews(
  request: APIRequestContext,
  ids: readonly string[],
) {
  const response = await request.post("/trpc/views.reorder", {
    data: { actor, ids },
  });
  expect(response.ok()).toBe(true);
}

export const toast = (page: Page) => page.locator(".toast");
/** The toast with this message; several toasts can be showing at once. */
export const toastSaying = (page: Page, text: string) =>
  toast(page).filter({ hasText: text });
/** Undo on the newest toast, which is first in the notification region. */
export const undo = (page: Page) =>
  toast(page).getByRole("button", { name: "Undo", exact: true }).first();
