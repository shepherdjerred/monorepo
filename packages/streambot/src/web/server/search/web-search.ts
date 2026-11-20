import { z } from "zod";
import type { MusicSearchProviders } from "@shepherdjerred/streambot/music/search-provider.ts";
import {
  BrowsePageSchema,
  SearchKindSchema,
  SearchResponseSchema,
  SuggestResponseSchema,
  type SearchKind,
} from "@shepherdjerred/streambot/web/shared/search-contracts.ts";
import type { WebSearchProvider } from "@shepherdjerred/streambot/observability/web-metrics.ts";
import {
  WebError,
  requestInput,
} from "@shepherdjerred/streambot/web/server/errors.ts";
import type { WebMusic } from "@shepherdjerred/streambot/web/server/music.ts";
import type { WebPlayback } from "@shepherdjerred/streambot/web/server/playback.ts";
import type { WebSession } from "@shepherdjerred/streambot/web/server/session-store.ts";
import { requestSignal, searchContext, type SearchContext } from "./context.ts";
import {
  historyGroup,
  libraryGroup,
  liveGroup,
  videosGroup,
} from "./groups.ts";
import {
  albumPage,
  artistPage,
  musicGroup,
  rethrowProviderFailure,
} from "./music-groups.ts";
import { observeSearch, type Group } from "./observe.ts";
import { pastedUrl } from "./rows.ts";

const SUGGESTION_LIMIT = 8;

const SearchInputSchema = z.object({
  guildId: z.string(),
  kind: SearchKindSchema,
  q: z.string().trim().max(300).default(""),
});
const SuggestInputSchema = z.object({
  guildId: z.string().optional(),
  q: z.string().trim().max(100).default(""),
});
const BrowseInputSchema = z.object({
  guildId: z.string(),
  id: z.string().min(1).max(100),
});

/** The first-party source behind each group that is not music. */
const SOURCE_LABELS = {
  library: "local",
  videos: "youtube",
  live: "sports",
  history: "history",
} as const satisfies Partial<Record<SearchKind, WebSearchProvider>>;

function input<Schema extends z.ZodType>(
  schema: Schema,
  url: URL,
): z.output<Schema> {
  return requestInput(schema, Object.fromEntries(url.searchParams));
}

/** `GET /api/search/v2` and its typeahead and browse companions; one group per request. */
export class WebSearch {
  constructor(
    private readonly playback: WebPlayback,
    private readonly music: WebMusic,
  ) {}

  async handle(
    request: Request,
    url: URL,
    session: WebSession,
  ): Promise<Response | null> {
    const handler = {
      "/api/search/v2": () => this.search(request, url, session),
      "/api/search/v2/suggest": () => this.suggest(request, url, session),
      "/api/music/v2/album": () => this.browse(request, url, session, "album"),
      "/api/music/v2/artist": () =>
        this.browse(request, url, session, "artist"),
    }[url.pathname];
    if (handler === undefined) return null;
    if (request.method !== "GET")
      throw new WebError(405, "method", "This method is not supported.");
    return Response.json(await handler());
  }

  private providers(): MusicSearchProviders {
    const providers = this.playback.deps.musicSearch;
    if (providers === undefined)
      throw new Error("Music search providers are not wired");
    return providers;
  }

  private context(request: Request, session: WebSession, guildId: string) {
    return searchContext(
      { playback: this.playback, music: this.music },
      request,
      session,
      guildId,
    );
  }

  private async search(request: Request, url: URL, session: WebSession) {
    const query = input(SearchInputSchema, url);
    const context = await this.context(request, session, query.guildId);
    const group = await this.group(context, query.kind, query.q);
    return SearchResponseSchema.parse({ kind: query.kind, ...group });
  }

  private async group(
    context: SearchContext,
    kind: SearchKind,
    query: string,
  ): Promise<Group> {
    const deps = { playback: this.playback, music: this.music };
    const { session, guildId, signal } = context;
    if (kind === "songs" || kind === "albums" || kind === "artists") {
      await this.music.require(session, guildId, "catalog");
      const provider = await this.providers().current(context.scope);
      try {
        return await observeSearch({
          kind,
          provider: provider.name,
          signal,
          work: () => musicGroup({ deps, context, provider, kind, query }),
        });
      } catch (error) {
        return rethrowProviderFailure(error);
      }
    }
    if (
      kind === "live" &&
      !(await this.playback.sportsEnabled(session, guildId))
    )
      throw new WebError(
        403,
        "sports_disabled",
        "Live sports are not enabled in this server.",
      );
    if (
      kind === "history" &&
      !(await this.playback.historyEnabled(session, guildId))
    )
      throw new WebError(
        403,
        "history_disabled",
        "Playback history is not enabled here.",
      );
    const groups = {
      library: () => Promise.resolve(libraryGroup(deps, context, query)),
      videos: () => videosGroup(deps, context, query),
      live: () => liveGroup(deps, context, query),
      history: () => historyGroup(deps, context, query),
    };
    return await observeSearch({
      kind,
      provider: SOURCE_LABELS[kind],
      signal,
      work: groups[kind],
    });
  }

  private async suggest(request: Request, url: URL, session: WebSession) {
    const query = input(SuggestInputSchema, url);
    // Typeahead is public provider data; a server, when given, still gates it like search does.
    const context =
      query.guildId === undefined
        ? undefined
        : await this.context(request, session, query.guildId);
    if (context !== undefined)
      await this.music.require(session, context.guildId, "catalog");
    if (query.q === "" || pastedUrl(query.q) !== null)
      return SuggestResponseSchema.parse({ suggestions: [] });
    const provider = await this.providers().current(
      context?.scope ?? {
        guildId: "",
        userId: session.identity.userId,
        channelId: "web",
      },
    );
    try {
      const result = await provider.suggestions(
        query.q,
        context?.signal ?? requestSignal(request),
      );
      return SuggestResponseSchema.parse({
        suggestions:
          result.kind === "unsupported"
            ? []
            : result.items.slice(0, SUGGESTION_LIMIT),
      });
    } catch (error) {
      return rethrowProviderFailure(error);
    }
  }

  private async browse(
    request: Request,
    url: URL,
    session: WebSession,
    kind: "album" | "artist",
  ) {
    const query = input(BrowseInputSchema, url);
    const context = await this.context(request, session, query.guildId);
    await this.music.require(session, context.guildId, "catalog");
    const provider = await this.providers().current(context.scope);
    const deps = { playback: this.playback, music: this.music };
    try {
      return BrowsePageSchema.parse(
        kind === "album"
          ? await albumPage(deps, context, provider, query.id)
          : await artistPage(deps, context, provider, query.id),
      );
    } catch (error) {
      return rethrowProviderFailure(error);
    }
  }
}
