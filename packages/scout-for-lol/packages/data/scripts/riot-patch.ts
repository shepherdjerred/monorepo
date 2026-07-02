// Pull the real League patch number from Riot's patch-notes feed.
//
// Data Dragon versions (e.g. "16.13.1") do NOT match the player-facing patch
// number (e.g. "26.13") — the minor (week) matches but the major differs. So
// the changelog must reference the real patch from Riot, not the Data Dragon
// version. Riot's patch-notes index server-renders a `__NEXT_DATA__` JSON blob
// with each article's title, tagline, and URL; a plain `fetch()` (no headless
// browser) returns it, so this works from the Temporal worker.
//
// The HTML-extraction + JSON-walk is split from the network call so the parser
// is unit-tested against a fixture.

import { z } from "zod";

export const PATCH_NOTES_TAG_URL =
  "https://www.leagueoflegends.com/en-us/news/tags/patch-notes/";
const RIOT_BASE = "https://www.leagueoflegends.com";
const PATCH_TITLE_PATTERN = /Patch (\d+)\.(\d+) Notes/;

export type RiotPatch = {
  /** Player-facing patch number, e.g. "26.13". */
  patch: string;
  major: number;
  minor: number;
  title: string;
  tagline: string;
  url: string;
};

// The shape of an article node inside Riot's `__NEXT_DATA__`. Both `url` and
// `action` appear across the feed; either may carry the weblink payload.
const WeblinkSchema = z.object({
  payload: z.object({ url: z.string().min(1) }),
});
const ArticleSchema = z.object({
  title: z.string(),
  description: z.object({ body: z.string() }).optional(),
  url: WeblinkSchema.optional(),
  action: WeblinkSchema.optional(),
});

function absolutize(url: string): string {
  return url.startsWith("http") ? url : `${RIOT_BASE}${url}`;
}

function collectPatchArticles(
  node: unknown,
  found: Map<string, RiotPatch>,
): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      collectPatchArticles(item, found);
    }
    return;
  }
  if (node === null || typeof node !== "object") {
    return;
  }

  const parsed = ArticleSchema.safeParse(node);
  if (parsed.success) {
    const match = PATCH_TITLE_PATTERN.exec(parsed.data.title);
    const weblink = parsed.data.url ?? parsed.data.action;
    if (match !== null && weblink !== undefined) {
      const major = Number(match[1]);
      const minor = Number(match[2]);
      const patch = `${String(major)}.${String(minor)}`;
      // First occurrence wins; the feed lists newest-first.
      if (!found.has(patch)) {
        found.set(patch, {
          patch,
          major,
          minor,
          title: parsed.data.title,
          tagline: parsed.data.description?.body ?? "",
          url: absolutize(weblink.payload.url),
        });
      }
    }
  }

  for (const value of Object.values(node)) {
    collectPatchArticles(value, found);
  }
}

/**
 * Parse every patch-notes article from the index HTML, newest first. Throws if
 * the page shape changed (no `__NEXT_DATA__`, bad JSON, or zero patches) so a
 * silent format drift fails loudly instead of producing a wrong entry.
 */
export function parsePatchesFromHtml(html: string): RiotPatch[] {
  const scriptMatch =
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (scriptMatch === null) {
    throw new Error("Riot patch-notes page: __NEXT_DATA__ script not found");
  }
  let data: unknown;
  try {
    data = JSON.parse(scriptMatch[1] ?? "");
  } catch (error) {
    throw new Error(
      `Riot patch-notes page: __NEXT_DATA__ is not valid JSON: ${String(error)}`,
    );
  }
  const found = new Map<string, RiotPatch>();
  collectPatchArticles(data, found);
  const patches = [...found.values()].sort(
    (a, b) => b.major - a.major || b.minor - a.minor,
  );
  if (patches.length === 0) {
    throw new Error(
      "Riot patch-notes page: no 'Patch X.Y Notes' articles found",
    );
  }
  return patches;
}

/**
 * Pick the patch whose minor (week) matches the Data Dragon minor, if posted.
 *
 * Riot's player-facing numbering is `YY.WW` (major = two-digit calendar year),
 * so once two years' patches coexist on the feed (e.g. `27.13` alongside a still
 * -listed `26.13`) matching on the minor alone would pick the wrong year's notes.
 * We therefore prefer the candidate whose major equals the current two-digit year
 * and only fall back to the newest same-minor patch when none matches — keeping
 * today's single-year behavior while defending against the future overlap.
 */
export function selectPatchByMinor(
  patches: readonly RiotPatch[],
  minor: number,
  now: Date = new Date(),
): RiotPatch | undefined {
  const candidates = patches.filter((patch) => patch.minor === minor);
  if (candidates.length === 0) {
    return undefined;
  }
  const currentYearMajor = now.getUTCFullYear() % 100;
  // `patches` is sorted newest-first, so candidates[0] is the newest fallback.
  return (
    candidates.find((patch) => patch.major === currentYearMajor) ??
    candidates[0]
  );
}

/**
 * Fetch + parse the patch-notes index. Throws on network/HTTP/parse failure
 * (fail fast) — callers decide whether a missing matching minor is fatal.
 */
export async function fetchPatches(): Promise<RiotPatch[]> {
  const response = await fetch(PATCH_NOTES_TAG_URL, {
    headers: {
      // Riot's CDN serves the rendered page only to browser-like clients.
      "User-Agent":
        "Mozilla/5.0 (compatible; ScoutForLoL/1.0; +https://scout-for-lol.com)",
      Accept: "text/html",
    },
  });
  if (!response.ok) {
    throw new Error(
      `Riot patch-notes page: HTTP ${String(response.status)} ${response.statusText}`,
    );
  }
  return parsePatchesFromHtml(await response.text());
}
