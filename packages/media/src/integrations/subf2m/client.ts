import { load } from "cheerio";
import {
  IntegrationError,
  request,
  type FetchTransport,
} from "#integrations/http.ts";
import { boundedBytes } from "#integrations/providers.ts";
import type { SubtitleScoreReferenceV1 } from "#shared/subtitle-maintenance/score.ts";
import { normalizeMediaTitle } from "#domain/release-parser.ts";

const BASE = "https://subf2m.co";
const ORDINALS = [
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
  "eleventh",
  "twelfth",
  "thirteenth",
  "fourteenth",
  "fifteenth",
  "sixteenth",
  "seventeenth",
  "eighteenth",
  "nineteenth",
  "twentieth",
];

function allowedPath(value: string): URL {
  const url = new URL(value, BASE);
  if (
    url.origin !== BASE ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    !/^\/(?:subtitles|subtitle|download)\/[\w/-]+$/iu.test(url.pathname) ||
    url.search !== ""
  )
    throw new IntegrationError("subf2m", "invalid-response");
  return url;
}

function titleMatches(value: string, reference: SubtitleScoreReferenceV1) {
  const year = /\s*\((\d{4})\)\s*$/u.exec(value);
  const title = value.replace(/(?:\s*\(\d{4}\))+\s*$/u, "").trim();
  if (
    year !== null &&
    reference.year !== null &&
    Number(year[1]) !== reference.year
  )
    return false;
  if (reference.kind === "movie")
    return (
      reference.year !== null &&
      year !== null &&
      normalizeMediaTitle(title) === normalizeMediaTitle(reference.title)
    );
  const season =
    /^(.*\S)\s[-–(]\s*([a-z]+|\d+)\s+(?:season|series)\)?$/iu.exec(title) ??
    /^(.*\S)\s[-–(]\s*(?:season|series)\s+([a-z]+|\d+)\)?$/iu.exec(title);
  if (season?.[1] === undefined || season[2] === undefined) return false;
  const number = /^\d+$/u.test(season[2])
    ? Number(season[2])
    : ORDINALS.indexOf(season[2].toLowerCase()) + 1;
  return (
    number > 0 &&
    number === reference.season &&
    normalizeMediaTitle(season[1]) === normalizeMediaTitle(reference.title)
  );
}

/** Fixed-origin bounded native HTML contract used by Bazarr's observed fallback.
 * Challenge pages stay an explicit interaction requirement. */
export class Subf2mProvider {
  constructor(private readonly transport: FetchTransport = fetch) {}
  private async read(url: URL, signal?: AbortSignal) {
    try {
      return await request(this.transport, "subf2m", url, {
        method: "GET",
        headers: {
          "User-Agent": "Media subtitle maintenance",
          Accept: "text/html,application/zip",
        },
        ...(signal === undefined ? {} : { signal }),
      });
    } catch (error) {
      if (error instanceof IntegrationError && error.status === 403)
        throw new IntegrationError("subf2m", "interaction-required", 403);
      throw error;
    }
  }
  private async html(url: URL, signal?: AbortSignal) {
    const response = await this.read(url, signal);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      await boundedBytes(response, 2 * 1024 * 1024, "subf2m"),
    );
    if (/cf-chl-|challenge-platform|just a moment/iu.test(text))
      throw new IntegrationError("subf2m", "interaction-required");
    return load(text);
  }
  async search(reference: SubtitleScoreReferenceV1, signal?: AbortSignal) {
    const url = new URL("/subtitles/searchbytitle", BASE);
    url.search = new URLSearchParams({
      query: reference.title,
      l: "",
    }).toString();
    const page = await this.html(url, signal);
    const paths = page("li div.title a")
      .toArray()
      .filter((node) => titleMatches(page(node).text().trim(), reference))
      .slice(0, 3)
      .map((node) => allowedPath(page(node).attr("href") ?? "").pathname);
    const candidates: { page: string; release: string; description: string }[] =
      [];
    for (const path of new Set(paths)) {
      const document = await this.html(allowedPath(`${path}/english`), signal);
      const imdb = document(".header h2 a[href*='imdb.com/title/']")
        .first()
        .attr("href")
        ?.match(/\/(tt\d+)(?:\/|$)/u)?.[1];
      if (
        imdb !== undefined &&
        reference.imdbId !== null &&
        imdb !== reference.imdbId
      )
        continue;
      for (const item of document("li.item").toArray().slice(0, 100)) {
        const anchor = document(item).find("a.download.icon-download").first();
        const href = anchor.attr("href");
        if (href === undefined) continue;
        const destination = allowedPath(href).pathname;
        const description = document(item).find(".comment-col p").text().trim();
        for (const release of document(item)
          .find("ul.scrolllist li")
          .toArray()
          .map((node) => document(node).text().trim())
          .filter((value) => value.length > 0))
          candidates.push({ page: destination, release, description });
      }
    }
    return candidates.slice(0, 100);
  }
  async download(page: string, signal?: AbortSignal) {
    const document = await this.html(allowedPath(page), signal);
    const href = document("a#downloadButton").attr("href");
    if (href === undefined)
      throw new IntegrationError("subf2m", "invalid-response");
    return boundedBytes(
      await this.read(allowedPath(href), signal),
      8 * 1024 * 1024,
      "subf2m",
    );
  }
}
