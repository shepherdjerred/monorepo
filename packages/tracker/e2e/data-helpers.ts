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
      title: `Seeded backlog item ${String(index + 1)}`,
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

export const toast = (page: Page) => page.locator(".toast");
/** The toast with this message; several toasts can be showing at once. */
export const toastSaying = (page: Page, text: string) =>
  toast(page).filter({ hasText: text });
/** Undo on the newest toast, which is first in the notification region. */
export const undo = (page: Page) =>
  toast(page).getByRole("button", { name: "Undo", exact: true }).first();
