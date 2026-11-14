import type { SportsPageRenderer } from "./pinchtab.ts";
import type {
  PreparedSportsInput,
  PrepareSportsInput,
} from "./prepared-input.ts";
import { prepareLoaderHls } from "./loader-hls.ts";
import { prepareClearKey } from "./clearkey.ts";
import { SportsPlaybackError } from "./failures.ts";

type Page = { html: string; headers: Readonly<Record<string, string>> };
type Candidate = { url: string };

function rootTitle(html: string): string | undefined {
  const title = /<title[^>]*>([^<]*)<\/title>/iu.exec(html)?.[1];
  const plain = title
    ?.replaceAll("&amp;", "&")
    .replaceAll("&#39;", "'")
    .replace(/\s*\|\s*StreamEast.*$/iu, "")
    .trim();
  return plain === "" ? undefined : plain;
}

function assertFreeStreams(html: string): void {
  const streams = html.match(/<li\b[^>]+data-stream-i="\d+"[^>]*>/giu) ?? [];
  if (
    streams.length > 0 &&
    streams.every((tag) => /\bclass="[^"]*\bis-pro\b/iu.test(tag))
  ) {
    throw new SportsPlaybackError("subscriber-only");
  }
}

export type ValidateSportsInput = (
  input: PreparedSportsInput,
  signal: AbortSignal,
) => Promise<PreparedSportsInput>;
type LegacyResolve = (
  url: string,
  signal: AbortSignal,
) => Promise<Omit<PreparedSportsInput, "close">>;

async function prepareLegacyInput(
  url: string,
  signal: AbortSignal,
  legacy: LegacyResolve,
  validate: ValidateSportsInput,
): Promise<PreparedSportsInput> {
  const input = {
    ...(await legacy(url, signal)),
    close: () => Promise.resolve(),
  };
  try {
    const result = await validate(input, signal);
    signal.throwIfAborted();
    return result;
  } catch (error) {
    await input.close();
    throw error;
  }
}

function approvedWatch(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    (url.hostname === "v2.streameast.ga" &&
      !/^\/[a-z0-9-]+\/[\w-]+(?:\/\d+)?\/?$/iu.test(url.pathname)) ||
    !["v2.streameast.ga", "tvsportslive.fr"].includes(url.hostname)
  )
    throw new SportsPlaybackError("unsupported-format");
  return url;
}

function watchCandidates(html: string, source: URL): Candidate[] {
  const basePath = source.pathname
    .replace(/\/\d+\/?$/, "/")
    .replace(/\/?$/, "/");
  const links = [
    ...html.matchAll(/<li\b[^>]+data-stream-i="\d+"[^>]*>[\s\S]*?<\/li>/gi),
  ]
    .filter(([tag]) => !/\bis-pro\b/.test(tag))
    .flatMap(([tag]) => {
      const href = /<a\b[^>]+href="([^"]+)"/i.exec(tag)?.[1];
      if (href === undefined) return [];
      const url = new URL(href.replaceAll("&amp;", "&"), source);
      const suffix = url.pathname.slice(basePath.length);
      return url.origin === source.origin &&
        url.pathname.startsWith(basePath) &&
        /^\d+\/?$/.test(suffix) &&
        !url.search &&
        !url.hash
        ? [{ url: url.href }]
        : [];
    });
  return [
    { url: source.href },
    ...links.filter((link) => link.url !== source.href),
  ];
}

function freePlayerFrames(html: string, page: string): string[] {
  return [...html.matchAll(/<iframe\b[^>]+src=["']([^"']+)["']/gi)].flatMap(
    ([, src]) => {
      if (src === undefined) return [];
      const url = new URL(src.replaceAll("&amp;", "&"), page);
      return url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.port &&
        url.hostname === "v2.streameast.ga" &&
        url.pathname === "/ClearKeyEmbed.php"
        ? [url.href]
        : [];
    },
  );
}

/** Preparation owns the entire candidate attempt, including validation and failed-lease cleanup. */
export function createSportsPreparer(
  browser: SportsPageRenderer,
  legacy: LegacyResolve,
  validate: ValidateSportsInput,
): PrepareSportsInput {
  const read = async (url: string, signal: AbortSignal): Promise<Page> =>
    browser.mediaPage === undefined
      ? { html: await browser.html(url, signal), headers: {} }
      : await browser.mediaPage(url, signal);
  const modern = async (page: Page, url: string, signal: AbortSignal) => {
    const loader = await prepareLoaderHls(page.html, url, signal, {
      headers: page.headers,
    });
    if (loader !== null) return loader;
    for (const frame of freePlayerFrames(page.html, url)) {
      const child = await read(frame, signal);
      const prepared = await prepareClearKey(child.html, frame, signal, {
        headers: child.headers,
      });
      if (prepared !== null) return prepared;
    }
    return null;
  };
  const readCandidate = async (
    candidate: Candidate,
    source: URL,
    page: Page,
    signal: AbortSignal,
  ) => {
    return candidate.url === source.href
      ? page
      : await read(candidate.url, signal);
  };
  return async (recipe, signal) => {
    const source = approvedWatch(recipe.sourceUrl);
    if (source.hostname === "tvsportslive.fr")
      return await prepareLegacyInput(source.href, signal, legacy, validate);
    const page = await read(source.href, signal);
    if (/\bshowEndedScreen\s*:\s*true/.test(page.html))
      throw new SportsPlaybackError("ended");
    assertFreeStreams(page.html);
    const title = rootTitle(page.html);
    const candidates = watchCandidates(page.html, source);
    let last: unknown;
    for (const candidate of candidates) {
      signal.throwIfAborted();
      let prepared: PreparedSportsInput | null = null;
      try {
        const candidatePage = await readCandidate(
          candidate,
          source,
          page,
          signal,
        );
        prepared = await modern(candidatePage, candidate.url, signal);
        if (prepared === null) {
          const direct = await legacy(candidate.url, signal);
          prepared = { ...direct, close: () => Promise.resolve() };
        }
        const result = await validate(prepared, signal);
        signal.throwIfAborted();
        return title === undefined ? result : { ...result, title };
      } catch (error) {
        if (prepared !== null) await prepared.close();
        signal.throwIfAborted();
        last = error;
      }
    }
    if (last instanceof SportsPlaybackError) throw last;
    throw new SportsPlaybackError("unavailable");
  };
}
