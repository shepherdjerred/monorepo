import { createHmac, randomBytes } from "node:crypto";
import type { LibraryEntry } from "@shepherdjerred/streambot/sources/library.ts";
import { searchLibrary } from "@shepherdjerred/streambot/sources/library.ts";
import type { DiscoveryService } from "@shepherdjerred/streambot/discovery/discovery-service.ts";
import { inferMediaIntent } from "@shepherdjerred/streambot/discovery/media-intent.ts";
import type { DiscoveryScope } from "@shepherdjerred/streambot/discovery/candidate.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import {
  LibraryQuerySchema,
  SearchQuerySchema,
  type LibraryTitleSchema,
  type WebCommand,
} from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { Selections } from "./selections.ts";
import { WebError, requestInput } from "./errors.ts";
import { WebArtwork } from "./artwork.ts";
import { WebSports } from "./sports.ts";
import type { PosterFetcher } from "@shepherdjerred/streambot/metadata/tmdb.ts";
import type { SportsCatalog } from "@shepherdjerred/streambot/sports/types.ts";
import type { LibraryArtworkProvider } from "@shepherdjerred/streambot/metadata/plex.ts";
import type { z } from "zod";

export class WebCatalog {
  private readonly key = randomBytes(32);
  private readonly candidates = new Selections<Source>();
  readonly artwork: WebArtwork;
  readonly sports: WebSports;
  constructor(
    private readonly library: () => readonly LibraryEntry[],
    private readonly discovery: DiscoveryService,
    options: {
      fetchPoster?: PosterFetcher;
      sports?: SportsCatalog;
      plexArtwork?: LibraryArtworkProvider;
    } = {},
  ) {
    this.artwork = new WebArtwork(
      library,
      options.fetchPoster,
      options.plexArtwork,
    );
    this.sports = new WebSports(options.sports);
  }

  browse(params: URLSearchParams, plexEnabled = false) {
    const query = requestInput(LibraryQuerySchema, Object.fromEntries(params));
    const all = this.library();
    const entries =
      query.query.length === 0
        ? all
        : searchLibrary(all, query.query, all.length);
    const matches = entries
      .filter(
        (entry) =>
          (query.library === "" || entry.library === query.library) &&
          (query.series === "" || entry.series === query.series),
      )
      .toSorted(
        (a, b) =>
          (a.series ?? a.title).localeCompare(b.series ?? b.title) ||
          (a.season ?? 0) - (b.season ?? 0) ||
          (a.episode ?? 0) - (b.episode ?? 0) ||
          a.title.localeCompare(b.title),
      );
    const lists = {
      libraries: [...new Set(all.map((entry) => entry.library))].toSorted(),
      series: [
        ...new Set(
          all.flatMap((entry) =>
            entry.series === undefined ? [] : [entry.series],
          ),
        ),
      ].toSorted(),
    };
    const item = (entry: LibraryEntry) => ({
      id: this.id(entry.path),
      title: entry.title,
      library: entry.library,
      ...(entry.year === undefined ? {} : { year: entry.year }),
      ...(entry.series === undefined ? {} : { series: entry.series }),
      ...(entry.season === undefined ? {} : { season: entry.season }),
      ...(entry.episode === undefined ? {} : { episode: entry.episode }),
      ...this.image(this.artwork.forEntry(entry, params.get("guildId") ?? "")),
    });
    if (plexEnabled && query.view === "titles") {
      const titles = this.titles(matches, item, params.get("guildId") ?? "");
      return {
        view: "titles" as const,
        items: titles.slice(query.offset, query.offset + 50),
        total: titles.length,
        ...lists,
      };
    }
    return {
      items: matches
        .slice(query.offset, query.offset + 50)
        .map((entry) => item(entry)),
      total: matches.length,
      ...lists,
    };
  }

  private titles(
    matches: readonly LibraryEntry[],
    item: (
      entry: LibraryEntry,
    ) => Omit<
      Extract<z.infer<typeof LibraryTitleSchema>, { kind: "file" }>,
      "kind"
    >,
    guildId: string,
  ) {
    const groups = new Map<string, LibraryEntry[]>();
    const titles: z.infer<typeof LibraryTitleSchema>[] = [];
    for (const entry of matches) {
      if (entry.series === undefined)
        titles.push({ kind: "file", ...item(entry) });
      else {
        const key = JSON.stringify([entry.library, entry.series]);
        const group = groups.get(key);
        if (group === undefined) groups.set(key, [entry]);
        else group.push(entry);
      }
    }
    for (const [key, group] of groups) {
      const first = group[0];
      if (first?.series === undefined)
        throw new Error("A series group has no series entry");
      titles.push({
        kind: "series",
        id: this.id("series:" + key),
        title: first.series,
        series: first.series,
        library: first.library,
        episodes: group.length,
        seasons: new Set(
          group.flatMap((entry) =>
            entry.season === undefined ? [] : [entry.season],
          ),
        ).size,
        ...this.image(this.artwork.forEntry(first, guildId)),
      });
    }
    titles.sort(
      (a, b) =>
        a.title.localeCompare(b.title) ||
        a.library.localeCompare(b.library) ||
        a.id.localeCompare(b.id),
    );
    return titles;
  }

  async search(
    params: URLSearchParams,
    scope: DiscoveryScope,
    owner: string,
    signal: AbortSignal,
  ) {
    const input = requestInput(SearchQuerySchema, Object.fromEntries(params));
    const candidates = await this.discovery.search(
      inferMediaIntent({ query: input.query, source: input.source }),
      scope,
      signal,
    );
    return candidates.map((candidate) => ({
      id: this.candidates.add(owner, candidate.source),
      title: candidate.title,
      provider: candidate.provider,
      ...this.image(
        this.artwork.forSource(
          candidate.source,
          scope.guildId,
          candidate.thumbnailUrl,
        ),
      ),
      ...(candidate.channel === undefined
        ? {}
        : { channel: candidate.channel }),
      ...(candidate.durationSeconds === undefined
        ? {}
        : { durationSeconds: candidate.durationSeconds }),
    }));
  }

  select(
    selection: Extract<WebCommand, { action: "play" }>["selection"],
    owner: string,
  ): { source: Source; title: string } {
    if (selection.kind === "history")
      throw new Error("History selections must be validated by WebHistory");
    if (selection.kind === "sports")
      return this.sports.select(selection.id, owner);
    if (selection.kind === "url")
      return {
        source: { kind: "url", url: selection.url },
        title: selection.url,
      };
    if (selection.kind === "candidate")
      return {
        source: this.candidates.get(owner, selection.id),
        title: "Selected media",
      };
    const entry = this.library().find(
      (item) => this.id(item.path) === selection.id,
    );
    if (entry === undefined)
      throw new WebError(
        409,
        "library_changed",
        "This media is no longer in the library. Refresh and select it again.",
      );
    return {
      source: { kind: "file", path: entry.path, title: entry.title },
      title: entry.title,
    };
  }

  private id(path: string): string {
    return createHmac("sha256", this.key).update(path).digest("hex");
  }

  private image(artworkUrl: string | undefined) {
    return artworkUrl === undefined ? {} : { artworkUrl };
  }
}
