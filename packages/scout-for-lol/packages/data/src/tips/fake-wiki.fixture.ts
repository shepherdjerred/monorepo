import type { WikiClient, WikiRevision } from "#src/tips/wiki.ts";

export type FakeWikiPage = { revid: number; text: string };

export type FakeWiki = WikiClient & {
  pages: Map<string, FakeWikiPage>;
  /** Titles asked for through `page`, in order. */
  fetched: string[];
  /** Edit a page: a new revision and, optionally, new text. */
  edit: (title: string, text?: string) => void;
};

/** A wiki held in memory: every title it knows is a page, every other title is missing. */
export function fakeWiki(initial: Readonly<Record<string, string>>): FakeWiki {
  const pages = new Map<string, FakeWikiPage>(
    Object.entries(initial).map(([title, text], index) => [
      title,
      { revid: 1000 + index, text },
    ]),
  );
  const fetched: string[] = [];
  const revisionOf = (title: string): WikiRevision | undefined => {
    const page = pages.get(title);
    return page === undefined
      ? undefined
      : { title, revid: page.revid, touched: "2026-01-01T00:00:00Z" };
  };
  return {
    pages,
    fetched,
    edit: (title, text) => {
      const page = pages.get(title);
      pages.set(title, {
        revid: (page?.revid ?? 1000) + 1,
        text: text ?? page?.text ?? "",
      });
    },
    revisions: (titles) =>
      Promise.resolve(
        new Map(titles.map((title) => [title, revisionOf(title)])),
      ),
    page: (title) => {
      fetched.push(title);
      const page = pages.get(title);
      return Promise.resolve(
        page === undefined ? undefined : { title, ...page },
      );
    },
    search: (query) =>
      Promise.resolve(
        [...pages.keys()].filter((title) =>
          title.toLowerCase().includes(query.toLowerCase()),
        ),
      ),
  };
}

/** Wiki pages for the example champions, with the one interaction the tests lean on. */
export const FAKE_WIKI_PAGES: Readonly<Record<string, string>> = {
  Ahri: "Orb of Deception passes through minions and enemies. Charm hits the first enemy and is blocked by minions.",
  "Ahri/Patch history": "V26.06: Charm cooldown changed.",
  Syndra: "Scatter the Weak knocks back spheres and enemies.",
  "Syndra/Patch history": "V26.07: Dark Sphere damage changed.",
  Slow: "A slow reduces movement speed.",
};
