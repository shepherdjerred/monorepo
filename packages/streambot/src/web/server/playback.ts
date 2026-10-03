import { PlaybackCommandService } from "@shepherdjerred/streambot/commands/playback-command-service.ts";
import type { SessionManager } from "@shepherdjerred/streambot/session/session-manager.ts";
import type { SessionHandle } from "@shepherdjerred/streambot/session/session-types.ts";
import { IDLE_VIEW } from "@shepherdjerred/streambot/session/session-types.ts";
import type { PlaybackCommandServiceDeps } from "@shepherdjerred/streambot/commands/playback-command-types.ts";
import type { MediaFeatureGate } from "@shepherdjerred/streambot/config/media-features.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
  UserIdSchema,
  type ChannelId,
} from "@shepherdjerred/streambot/types/ids.ts";
import type { WebDiscordContext } from "@shepherdjerred/streambot/discord/web-context.ts";
import { sportsEventForSource } from "@shepherdjerred/streambot/sports/sports-resolver.ts";
import type {
  WebCommand,
  WebSnapshot,
} from "@shepherdjerred/streambot/web/shared/contracts.ts";
import type { WebSession } from "./session-store.ts";
import { WebError, requestInput } from "./errors.ts";
import type { WebCatalog } from "./catalog.ts";

export type WebPlaybackDeps = {
  sessions: Pick<
    SessionManager,
    "getExisting" | "ensureForPlay" | "releaseUnused" | "revision"
  >;
  bot: Pick<
    WebDiscordContext,
    "webGuilds" | "webVerifyMember" | "webVoiceChannel" | "webReady"
  >;
  commands: Omit<
    PlaybackCommandServiceDeps,
    | "dispatch"
    | "view"
    | "setVolume"
    | "seek"
    | "guildId"
    | "channelId"
    | "authorization"
    | "assertCurrent"
    | "announce"
  >;
  announce: (channelId: ChannelId, message: string) => Promise<void>;
  featureGate: MediaFeatureGate;
  webEnabled: (guildId: string, userId: string) => Promise<boolean>;
  catalog: WebCatalog;
};

export class WebPlayback {
  constructor(readonly deps: WebPlaybackDeps) {}

  async authorize(session: WebSession, guild: string): Promise<void> {
    const guildId = requestInput(GuildIdSchema, guild);
    if (
      !session.identity.guildIds.includes(guildId) ||
      !this.deps.bot.webGuilds([guildId]).some((item) => item.id === guildId)
    ) {
      throw new WebError(
        403,
        "guild_denied",
        "Choose a server you share with Streambot.",
      );
    }
    if (!(await this.deps.webEnabled(guildId, session.identity.userId)))
      throw new WebError(
        403,
        "feature_disabled",
        "The web remote is not enabled for this server yet.",
      );
    if (
      !(await this.deps.bot.webVerifyMember(guildId, session.identity.userId))
    )
      throw new WebError(
        403,
        "guild_denied",
        "You are no longer a member of this server.",
      );
  }

  async snapshot(session: WebSession, guild: string): Promise<WebSnapshot> {
    await this.authorize(session, guild);
    const guildId = GuildIdSchema.parse(guild);
    const channel = this.deps.bot.webVoiceChannel(
      guildId,
      session.identity.userId,
    );
    const handle =
      channel === null
        ? null
        : this.deps.sessions.getExisting(guildId, channel.id);
    const view = handle?.view() ?? IDLE_VIEW;
    const advancedControls =
      channel !== null &&
      (await this.deps.featureGate.assistantV2({
        guildId,
        channelId: channel.id,
        userId: session.identity.userId,
      }));
    const source = view.current?.source;
    return {
      channel,
      revision:
        channel === null
          ? null
          : this.deps.sessions.revision(guildId, channel.id),
      state: view.state,
      current:
        view.current === null ? null : this.playerItem(view.current, guildId),
      queue: view.queue.map((item) => this.playerItem(item, guildId)),
      positionSeconds: view.positionSeconds,
      paused: view.paused === true,
      volume: view.volume,
      loop: view.loop,
      advancedControls,
      sportsEnabled: await this.sportsEnabled(session, guildId),
      restrictedLive:
        source?.kind === "url" && sportsEventForSource(source.url) !== null,
    };
  }

  async sportsEnabled(session: WebSession, guildId: string): Promise<boolean> {
    return (
      (await this.deps.featureGate.sportsStreaming?.({
        guildId,
        channelId:
          this.deps.bot.webVoiceChannel(
            GuildIdSchema.parse(guildId),
            session.identity.userId,
          )?.id ?? "web",
        userId: session.identity.userId,
      })) === true
    );
  }

  private playerItem(
    item: ReturnType<SessionHandle["view"]>["queue"][number],
    guildId: string,
  ) {
    const artworkUrl = this.deps.catalog.artwork.forSource(
      item.source,
      guildId,
      item.provenance?.thumbnailUrl,
    );
    return {
      title: this.deps.catalog.sports.title(item.source) ?? item.title,
      durationSeconds: item.durationSeconds,
      mediaKind: item.mediaKind,
      ...(artworkUrl === undefined ? {} : { artworkUrl }),
    };
  }

  async commandContext(session: WebSession, input: WebCommand) {
    await this.authorize(session, input.guildId);
    const guildId = GuildIdSchema.parse(input.guildId);
    const channelId = ChannelIdSchema.parse(input.channelId);
    const userId = UserIdSchema.parse(session.identity.userId);
    let revision = input.revision;
    const guard = () => {
      if (this.deps.bot.webVoiceChannel(guildId, userId)?.id !== channelId)
        throw new WebError(
          409,
          "channel_changed",
          "Your voice channel changed. Refresh and try again.",
        );
      if (this.deps.sessions.revision(guildId, channelId) !== revision)
        throw new WebError(
          409,
          "playback_changed",
          "Playback or the queue changed. Refresh and try again.",
        );
    };
    guard();
    if (
      ["pause", "resume"].includes(input.action) ||
      (input.action === "play" && input.placement === "now")
    ) {
      if (
        !(await this.deps.featureGate.assistantV2({
          guildId,
          channelId,
          userId,
        }))
      )
        throw new WebError(
          403,
          "feature_disabled",
          "This playback control is not enabled in this server.",
        );
      guard();
    }
    let handle = this.deps.sessions.getExisting(guildId, channelId);
    if (handle === null && input.action === "play") {
      handle = this.deps.sessions.ensureForPlay({
        guildId,
        voiceChannelId: channelId,
        statusChannelId: channelId,
      });
      revision = this.deps.sessions.revision(guildId, channelId);
    }
    if (handle === null)
      throw new WebError(
        409,
        "no_session",
        input.action === "play"
          ? "No stream bots are available right now. Try again shortly."
          : "Nothing is playing in your voice channel.",
      );
    const boundHandle = handle;
    const guarded = <T>(action: () => T): T => {
      guard();
      const result = action();
      revision = this.deps.sessions.revision(guildId, channelId);
      return result;
    };
    const service = new PlaybackCommandService({
      ...this.deps.commands,
      assertCurrent: guard,
      announce: (message) => this.deps.announce(channelId, message),
      guildId,
      channelId,
      dispatch: (event) => {
        guarded(() => {
          boundHandle.dispatch(event);
        });
      },
      view: boundHandle.view,
      setVolume: (percent) => guarded(() => boundHandle.setVolume(percent)),
      seek: (seconds) => guarded(() => boundHandle.seek(seconds)),
      authorization: {
        controlItem: (actor) =>
          actor === userId &&
          this.deps.bot.webVoiceChannel(guildId, actor)?.id === channelId,
        manageQueue: (actor) =>
          actor === userId &&
          this.deps.bot.webVoiceChannel(guildId, actor)?.id === channelId,
      },
    });
    return {
      handle: boundHandle,
      service,
      guard,
      guarded,
      userId,
      guildId,
      channelId,
    };
  }
}
