import { mkdir, rename } from "node:fs/promises";
import { z } from "zod";
import type { WikiRevisions } from "#src/tips/schema.ts";

/**
 * Read access to the official League of Legends Wiki (MediaWiki API), the
 * source of the mechanics Data Dragon leaves out (how a projectile treats
 * minions, what a status does, an item's passive). Used by the generator and
 * the eval judge, never by a page.
 *
 * - One host only: every request URL is checked against {@link WIKI_HOST}.
 * - Polite: requests run one at a time with a pause between them, with a
 *   descriptive User-Agent that names the product and nothing personal.
 * - Cached on disk by page and revision, so a page is downloaded once per
 *   revision. Revision ids are what a unit's input hash records, so a wiki
 *   edit regenerates only the units that used the edited page.
 */

export const WIKI_HOST = "wiki.leagueoflegends.com";
const API_URL = `https://${WIKI_HOST}/en-us/api.php`;
export const WIKI_USER_AGENT =
  "ScoutForLoL-TipGenerator/1.0 (+https://scout-for-lol.com; reads ability notes)";
const DEFAULT_DELAY_MS = 400;
const REVISION_BATCH = 50;
const MAX_ATTEMPTS = 4;

/** A page text the prompt can carry, in characters. */
export const MAX_PAGE_CHARS = 16_000;

export type WikiRevision = {
  /** The page's own title after redirects, for example `Ahri` for `Ahri/Abilities`. */
  title: string;
  revid: number;
  /** MediaWiki's `touched`: moves when a template or module the page uses changes. */
  touched: string;
};

export type WikiPageText = {
  title: string;
  revid: number;
  text: string;
};

export type WikiClient = {
  /** The current revision of each title, or undefined when no such page exists. */
  revisions: (
    titles: readonly string[],
  ) => Promise<Map<string, WikiRevision | undefined>>;
  /** The page's text at its current revision, or undefined when it does not exist. */
  page: (title: string) => Promise<WikiPageText | undefined>;
  /** Titles of the pages that best match a search, for a model that guessed a title. */
  search: (query: string) => Promise<string[]>;
};

export type WikiFetch = (
  url: URL,
  init: { headers: Record<string, string> },
) => Promise<Response>;

export function assertWikiUrl(url: URL): void {
  if (url.protocol !== "https:" || url.hostname !== WIKI_HOST) {
    throw new Error(
      `refusing to fetch ${url.origin}: only ${WIKI_HOST} is allowed`,
    );
  }
}

const RevisionsResponseSchema = z.object({
  query: z.object({
    normalized: z
      .array(z.object({ from: z.string(), to: z.string() }))
      .optional(),
    redirects: z
      .array(z.object({ from: z.string(), to: z.string() }))
      .optional(),
    pages: z.record(
      z.string(),
      z.object({
        title: z.string(),
        missing: z.unknown().optional(),
        touched: z.string().optional(),
        revisions: z.array(z.object({ revid: z.number().int() })).optional(),
      }),
    ),
  }),
});

const SectionsResponseSchema = z.object({
  parse: z.object({
    sections: z.array(
      z.object({ index: z.string(), line: z.string(), level: z.string() }),
    ),
  }),
});

const ParseResponseSchema = z.object({
  parse: z.object({ text: z.object({ "*": z.string() }) }),
});

const SearchResponseSchema = z.object({
  query: z.object({ search: z.array(z.object({ title: z.string() })) }),
});

const CachedPageSchema = z.strictObject({
  title: z.string(),
  revid: z.number().int(),
  text: z.string(),
});

function decodeEntities(text: string): string {
  return text
    .replaceAll(/&#160;|&nbsp;/gu, " ")
    .replaceAll(/&#9[13];/gu, "")
    .replaceAll("&#95;", "_")
    .replaceAll("&#176;", "°")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

/** Stat rows the grounding already carries (cooldown, cost, range): label line plus value line. */
const STAT_LABEL =
  /^(?:COST|COOLDOWN|CAST TIME|RANGE|EFFECT RADIUS|WIDTH|SPEED|CHARGE TIME|TARGET RANGE|RECHARGE|STATIC COOLDOWN|CHANNEL TIME|MAX ):?$/iu;

/**
 * Wiki HTML as the plain text a model reads: ability descriptions, notes and
 * interaction flags kept; edit links, damage-info tables, API notices and the
 * stat rows Data Dragon already supplies dropped.
 */
export function wikiHtmlToText(html: string): string {
  const rewritten: string = new HTMLRewriter()
    .on(
      "style, script, img, .mw-editsection, .mw-empty-elt, .toc, [title='Damage Info'], [title='Map-Specific Differences']",
      {
        element(element) {
          element.remove();
        },
      },
    )
    .on("p, div, li, tr, h1, h2, h3, h4, br, dt, dd, table", {
      element(element) {
        element.before("\n", { html: false });
        element.after("\n", { html: false });
      },
    })
    .transform(html);
  const flat = decodeEntities(rewritten.replaceAll(/<[^>]+>/gu, ""))
    .replaceAll(/[ \t]+/gu, " ")
    .replaceAll(/ ?\n ?/gu, "\n")
    .replaceAll(/Damage Details[\s\S]*?Bucket:Damage\.?/gu, "");
  const lines = flat.split("\n").map((line) => line.trim());
  const kept: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (STAT_LABEL.test(line)) {
      // Drop the value on the next non-empty line with its label.
      index += 1;
      while ((lines[index] ?? "x") === "") {
        index += 1;
      }
      continue;
    }
    if (
      line === "" ||
      line === "Edit" ||
      line === "NOTICE TO API USERS:" ||
      line.startsWith("Damage classifications are being amended")
    ) {
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n");
}

function clip(text: string, limit: number): string {
  return text.length <= limit
    ? text
    : `${text.slice(0, limit)}\n[truncated: ${(text.length - limit).toString()} more characters]`;
}

export function clipWikiText(text: string, limit = MAX_PAGE_CHARS): string {
  return clip(text, limit);
}

export type WikiClientOptions = {
  /** Where downloaded pages are kept, by page and revision. Not committed. */
  cacheDirectory: string;
  delayMs?: number;
  fetch?: WikiFetch;
  sleep?: (milliseconds: number) => Promise<void>;
};

export function createWikiClient(options: WikiClientOptions): WikiClient {
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const doFetch: WikiFetch = options.fetch ?? ((url, init) => fetch(url, init));
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, milliseconds);
      }));
  const revisionMemo = new Map<string, WikiRevision | undefined>();
  const pageMemo = new Map<string, Promise<WikiPageText | undefined>>();
  let tail: Promise<undefined> = Promise.resolve(undefined);

  /** One request at a time, a pause after each. */
  async function request<T>(
    parameters: Record<string, string>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const previous = tail;
    const turn = Promise.withResolvers<undefined>();
    tail = turn.promise;
    await previous;
    try {
      return await send(parameters, schema);
    } finally {
      turn.resolve(undefined);
    }
  }

  async function send<T>(
    parameters: Record<string, string>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const run = async (): Promise<T> => {
      const url = new URL(API_URL);
      for (const [key, value] of Object.entries({
        ...parameters,
        format: "json",
        formatversion: "1",
      })) {
        url.searchParams.set(key, value);
      }
      assertWikiUrl(url);
      for (let attempt = 1; ; attempt += 1) {
        const response = await doFetch(url, {
          headers: {
            "User-Agent": WIKI_USER_AGENT,
            Accept: "application/json",
          },
        });
        await sleep(delayMs);
        if (response.ok) {
          return schema.parse(await response.json());
        }
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt >= MAX_ATTEMPTS) {
          throw new Error(
            `wiki request failed: HTTP ${response.status.toString()} for ${url.searchParams.get("action") ?? "?"}`,
          );
        }
        const retryAfter = Number(response.headers.get("Retry-After"));
        await sleep(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : 2000 * attempt,
        );
      }
    };
    return run();
  }

  async function revisions(
    titles: readonly string[],
  ): Promise<Map<string, WikiRevision | undefined>> {
    const wanted = [...new Set(titles)].filter(
      (title) => !revisionMemo.has(title),
    );
    for (let from = 0; from < wanted.length; from += REVISION_BATCH) {
      const batch = wanted.slice(from, from + REVISION_BATCH);
      const response = await request(
        {
          action: "query",
          titles: batch.join("|"),
          prop: "revisions|info",
          rvprop: "ids",
          redirects: "1",
        },
        RevisionsResponseSchema,
      );
      const normalized = new Map(
        (response.query.normalized ?? []).map((entry) => [
          entry.from,
          entry.to,
        ]),
      );
      const redirects = new Map(
        (response.query.redirects ?? []).map((entry) => [entry.from, entry.to]),
      );
      const byTitle = new Map(
        Object.values(response.query.pages).map((page) => [page.title, page]),
      );
      for (const title of batch) {
        const normal = normalized.get(title) ?? title;
        const target = redirects.get(normal) ?? normal;
        const page = byTitle.get(target);
        const revid = page?.revisions?.[0]?.revid;
        revisionMemo.set(
          title,
          page === undefined ||
            revid === undefined ||
            page.missing !== undefined
            ? undefined
            : { title: page.title, revid, touched: page.touched ?? "" },
        );
      }
    }
    return new Map(titles.map((title) => [title, revisionMemo.get(title)]));
  }

  function cachePath(revision: WikiRevision): string {
    const key = new Bun.CryptoHasher("sha256")
      .update(`${revision.title}\n${revision.touched}`)
      .digest("hex")
      .slice(0, 24);
    return `${options.cacheDirectory}/${key}-${revision.revid.toString()}.json`;
  }

  async function download(revision: WikiRevision): Promise<WikiPageText> {
    const sections = await request(
      {
        action: "parse",
        oldid: revision.revid.toString(),
        prop: "sections",
      },
      SectionsResponseSchema,
    );
    const abilities = sections.parse.sections.find(
      (section) => section.line === "Abilities" && section.level === "2",
    );
    const parsed = await request(
      {
        action: "parse",
        oldid: revision.revid.toString(),
        prop: "text",
        disablelimitreport: "1",
        ...(abilities === undefined || abilities.index === ""
          ? {}
          : { section: abilities.index }),
      },
      ParseResponseSchema,
    );
    return {
      title: revision.title,
      revid: revision.revid,
      text: wikiHtmlToText(parsed.parse.text["*"]),
    };
  }

  async function loadPage(title: string): Promise<WikiPageText | undefined> {
    const found = await revisions([title]);
    const revision = found.get(title);
    if (revision === undefined) {
      return undefined;
    }
    const path = cachePath(revision);
    const cached = Bun.file(path);
    if (await cached.exists()) {
      return CachedPageSchema.parse(await cached.json());
    }
    const page = await download(revision);
    await mkdir(options.cacheDirectory, { recursive: true });
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    await Bun.write(temporary, JSON.stringify(page));
    await rename(temporary, path);
    return page;
  }

  return {
    revisions,
    page: (title) => {
      const memo = pageMemo.get(title) ?? loadPage(title);
      pageMemo.set(title, memo);
      return memo;
    },
    search: async (query) => {
      const response = await request(
        { action: "query", list: "search", srsearch: query, srlimit: "5" },
        SearchResponseSchema,
      );
      return response.query.search.map((entry) => entry.title);
    },
  };
}

/** A model-readable result for the `lookup` tool: the page, or the closest titles. */
export const LOOKUP_MAX_CHARS = 9000;

export type LookupResult = {
  text: string;
  /** The page the answer came from, page title to revision id; empty when none matched. */
  pages: WikiRevisions;
};

export async function lookupWikiPage(
  client: WikiClient,
  title: string,
): Promise<LookupResult> {
  const page = await client.page(title.trim());
  if (page !== undefined) {
    return {
      text: `${page.title} (revision ${page.revid.toString()})\n${clip(page.text, LOOKUP_MAX_CHARS)}`,
      pages: { [page.title]: page.revid },
    };
  }
  const close = await client.search(title);
  return {
    text:
      close.length === 0
        ? `No wiki page is titled "${title}" and nothing matches it.`
        : `No wiki page is titled "${title}". Closest titles: ${close.join("; ")}.`,
    pages: {},
  };
}

/** A champion's wiki pages: the page (its Abilities section is read) and its patch history. */
export function championWikiTitles(championName: string): string[] {
  return [championName, `${championName}/Patch history`];
}

export type PrefetchedWiki = {
  /** Ability notes of each champion, in the order given. */
  notes: string[];
  /** Every page the notes came from or watch, page title to revision id. */
  pages: WikiRevisions;
};

/**
 * The common case without a tool round trip: both champions' ability notes.
 * The patch-history page is recorded as well because ability data on the
 * champion page lives in templates, and a patch edits the history page.
 */
export async function prefetchChampionWiki(
  client: WikiClient,
  championNames: readonly string[],
): Promise<PrefetchedWiki> {
  const revisions = await client.revisions(
    championNames.flatMap((name) => championWikiTitles(name)),
  );
  const pages: Record<string, number> = {};
  const notes: string[] = [];
  for (const name of championNames) {
    const page = await client.page(name);
    if (page === undefined) {
      throw new Error(`the League of Legends Wiki has no page for ${name}`);
    }
    pages[page.title] = page.revid;
    notes.push(clip(page.text, MAX_PAGE_CHARS));
    const history = revisions.get(`${name}/Patch history`);
    if (history !== undefined) {
      pages[history.title] = history.revid;
    }
  }
  return { notes, pages };
}
