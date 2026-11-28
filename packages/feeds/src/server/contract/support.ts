import {
  AI_SDK_ONLY_RULE,
  STRICT_RELEASE_RULES,
} from "@shepherdjerred/feeds/catalog/rules.ts";
import type {
  DeclaredFeed,
  EntriesResponse,
} from "@shepherdjerred/feeds/shared/contract.ts";
import type {
  ConsoleEntriesQuery,
  FeedsRepository,
} from "@shepherdjerred/feeds/server/types.ts";

/** Opens an empty store of the backend under test. */
export type OpenStore = () => Promise<FeedsRepository>;

export const SAMPLE_CATALOG: readonly DeclaredFeed[] = [
  {
    category: "Engineering & Infra",
    title: "Hono Releases",
    url: "https://github.com/honojs/hono/releases.atom",
    htmlUrl: "https://github.com/honojs/hono/releases",
    autoRead: STRICT_RELEASE_RULES,
  },
  {
    category: "AI",
    title: "Vercel News — AI SDK",
    url: "https://vercel.com/atom",
    htmlUrl: "https://vercel.com/ai-sdk",
    autoRead: AI_SDK_ONLY_RULE,
  },
  {
    category: "Essays & Personal Blogs",
    title: "Jerred's Blog",
    url: "https://sjer.red/rss.xml",
    htmlUrl: "https://sjer.red/",
  },
  {
    category: "Engineering & Infra",
    title: "Visual Studio Code",
    url: "https://code.visualstudio.com/feed.xml",
    htmlUrl: "https://code.visualstudio.com/",
    hidden: true,
  },
];

export async function countEntries(
  store: FeedsRepository,
  query: ConsoleEntriesQuery,
): Promise<number> {
  const page = await store.queryEntries(query);
  return page.totalMatching;
}
export async function entryUrls(
  store: FeedsRepository,
  query: ConsoleEntriesQuery,
): Promise<string[]> {
  const page = await store.queryEntries(query);
  return page.items.map((item) => item.url);
}
export async function entryTitles(
  store: FeedsRepository,
  query: ConsoleEntriesQuery,
): Promise<string[]> {
  const page = await store.queryEntries(query);
  return page.items.map((item) => item.title);
}
export async function findEntry(
  store: FeedsRepository,
  query: ConsoleEntriesQuery,
  title: string,
): Promise<EntriesResponse["items"][number] | undefined> {
  const page = await store.queryEntries(query);
  return page.items.find((item) => item.title === title);
}
export async function firstEntry(
  store: FeedsRepository,
  query: ConsoleEntriesQuery,
): Promise<EntriesResponse["items"][number] | undefined> {
  const page = await store.queryEntries(query);
  return page.items[0];
}
