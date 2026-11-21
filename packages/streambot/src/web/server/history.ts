import type { MediaHistoryStore } from "@shepherdjerred/streambot/history/media-history.ts";
import { PlaybackCommandBoundaryError } from "@shepherdjerred/streambot/commands/playback-command-errors.ts";
import type {
  SportsCatalog,
  SportsEvent,
} from "@shepherdjerred/streambot/sports/types.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import { sportsEventForSource } from "@shepherdjerred/streambot/sports/sports-resolver.ts";
import { SPORTS_TIME_ZONE } from "@shepherdjerred/streambot/sports/parse-events.ts";
import { HistoryQuerySchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { GuildIdSchema } from "@shepherdjerred/streambot/types/ids.ts";
import type { WebCatalog } from "./catalog.ts";
import { Selections } from "./selections.ts";
import { WebError, requestInput } from "./errors.ts";
import type { WebPlaybackDeps } from "./playback-deps.ts";
import type { WebSession } from "./session-store.ts";
import { historyActions } from "./search/rows.ts";

type Replay = { source: Source; title: string; playedAt: number };
const date = (time: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: SPORTS_TIME_ZONE }).format(
    new Date(time),
  );

function sportsPlayable(
  replay: Replay,
  today: readonly SportsEvent[],
): boolean {
  const source = replay.source;
  if (source.kind !== "url" || sportsEventForSource(source.url) === null)
    return true;
  const saved = source.sportsEvent;
  return (
    saved !== undefined &&
    today.some(
      (event) =>
        event.id === saved.id &&
        event.pageUrl === source.url &&
        event.title === saved.title &&
        event.startsAt === saved.startsAt &&
        event.status !== "scheduled" &&
        (saved.startsAt !== null || date(replay.playedAt) === date(Date.now())),
    )
  );
}

export class WebHistory {
  private readonly selections = new Selections<Replay>();
  constructor(
    private readonly store: MediaHistoryStore | undefined,
    private readonly sports: SportsCatalog | undefined,
  ) {}

  /** One page of `/api/history`, each item carrying the replay buttons a search row would offer. */
  async browse(
    options: Parameters<WebHistory["browseWithSources"]>[0] & {
      listenAllowed: boolean;
    },
  ) {
    const page = await this.browseWithSources(options);
    return {
      total: page.total,
      items: page.items.map(({ item, source }) => ({
        ...item,
        ...historyActions({
          provider: item.provider,
          source,
          replayAvailable: item.replayAvailable,
          listenAllowed: options.listenAllowed,
        }),
      })),
    };
  }

  /** Each item beside the source it replays, for callers that need to know how it was queued. */
  async browseWithSources(options: {
    params: URLSearchParams;
    userId: string;
    owner: string;
    catalog: WebCatalog;
    sportsEnabled: boolean;
    requester: (guild: string, user: string) => Promise<string>;
    signal: AbortSignal;
  }) {
    const { params, userId, owner, catalog, sportsEnabled, requester, signal } =
      options;
    if (this.store === undefined)
      throw new WebError(
        503,
        "history_unavailable",
        "Playback history is unavailable.",
      );
    const input = requestInput(HistoryQuerySchema, Object.fromEntries(params));
    const page = this.store.browseRuns({
      ...input,
      userId,
      guildId: params.get("guildId") ?? "",
    });
    let today: readonly SportsEvent[] = [];
    if (
      sportsEnabled &&
      this.sports !== undefined &&
      page.items.some(
        (run) =>
          run.source.kind === "url" &&
          sportsEventForSource(run.source.url) !== null,
      )
    ) {
      try {
        today = await this.sports.listToday(signal);
      } catch (error) {
        signal.throwIfAborted();
        if (!(error instanceof PlaybackCommandBoundaryError)) throw error;
      }
    }
    const names = new Map<string, Promise<string>>();
    const entries = await Promise.all(
      page.items.map(async (run) => {
        const replay = {
          source: run.source,
          title: run.title,
          playedAt: run.started_at,
        };
        const artworkUrl = catalog.artwork.forSource(
          run.source,
          params.get("guildId") ?? "",
          run.thumbnail_url ?? undefined,
        );
        const key = run.guild_id + ":" + run.user_id;
        let name = names.get(key);
        if (name === undefined) {
          name = requester(run.guild_id, run.user_id);
          names.set(key, name);
        }
        const item = {
          id: this.selections.add(owner, replay),
          title: run.title,
          provider: run.provider,
          requester: { id: run.user_id, name: await name },
          queuedAt: run.created_at,
          playedAt: run.started_at,
          endedAt: run.ended_at,
          outcome: run.outcome,
          durationSeconds: run.duration_seconds,
          mediaKind: null,
          replayAvailable: sportsPlayable(replay, today),
          ...(artworkUrl === undefined ? {} : { artworkUrl }),
          ...(run.source.kind !== "url" ||
          run.source.sportsEvent?.artwork === undefined
            ? {}
            : { sportsArtwork: run.source.sportsEvent.artwork }),
        };
        return { item, source: run.source };
      }),
    );
    return { total: page.total, items: entries };
  }

  async select(
    id: string,
    owner: string,
    signal: AbortSignal,
  ): Promise<Replay> {
    const replay = this.selections.get(owner, id);
    if (
      replay.source.kind === "url" &&
      sportsEventForSource(replay.source.url) !== null
    ) {
      const today =
        this.sports === undefined ? [] : await this.sports.listToday(signal);
      if (!sportsPlayable(replay, today))
        throw new WebError(
          409,
          "event_ended",
          "This event is no longer available to replay.",
        );
    }
    return replay;
  }
}

/** What `/api/history` needs from `WebPlayback`, named here so the two modules form no cycle. */
type HistoryOwner = {
  readonly history: WebHistory;
  readonly deps: Pick<WebPlaybackDeps, "bot" | "catalog" | "featureGate">;
  historyEnabled: (session: WebSession, guildId: string) => Promise<boolean>;
  sportsEnabled: (session: WebSession, guildId: string) => Promise<boolean>;
  requesterName: (
    session: WebSession,
    guild: string,
    user: string,
  ) => Promise<string>;
};

/**
 * `GET /api/history`. Listen is offered on the same gate search uses, read for the viewer's
 * current voice channel, so a replay button never answers `listen_disabled`.
 */
export async function historyResponse(
  playback: HistoryOwner,
  request: Request,
  session: WebSession,
  guildId: string,
): Promise<Response> {
  if (!(await playback.historyEnabled(session, guildId)))
    throw new WebError(
      403,
      "history_disabled",
      "Playback history is not enabled here.",
    );
  const userId = session.identity.userId;
  const channel = playback.deps.bot.webVoiceChannel(
    GuildIdSchema.parse(guildId),
    userId,
  );
  return Response.json(
    await playback.history.browse({
      params: new URL(request.url).searchParams,
      userId,
      owner: session.key + ":" + guildId,
      catalog: playback.deps.catalog,
      sportsEnabled: await playback.sportsEnabled(session, guildId),
      requester: (guild, user) => playback.requesterName(session, guild, user),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
      listenAllowed: await playback.deps.featureGate.musicOverVoice({
        guildId,
        channelId: channel?.id ?? "web",
        userId,
      }),
    }),
  );
}
