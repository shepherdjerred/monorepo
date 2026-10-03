import { PlaybackCommandService } from "@shepherdjerred/streambot/commands/playback-command-service.ts";
import type { SessionManager } from "@shepherdjerred/streambot/session/session-manager.ts";
import type { NumberedSessions } from "@shepherdjerred/streambot/session/numbered-sessions.ts";
import {
  PlaybackChannelNumberSchema,
  playbackChannelLabel,
} from "@shepherdjerred/streambot/types/playback-channel.ts";
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
  > & {
    numbered: Pick<NumberedSessions, "selected" | "selection" | "maximum">;
  };
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
    | "playbackChannel"
  >;
  announce: (channelId: ChannelId, message: string) => Promise<void>;
  featureGate: MediaFeatureGate;
  webEnabled: (guildId: string, userId: string) => Promise<boolean>;
  catalog: WebCatalog;
};

export class WebPlayback {
  constructor(readonly deps: WebPlaybackDeps) {}

  async authorize(
    session: WebSession,
    guild: string,
    fresh = false,
  ): Promise<void> {
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
      !(await this.deps.bot.webVerifyMember(
        guildId,
        session.identity.userId,
        fresh,
      ))
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
    const playbackChannel =
      channel === null
        ? undefined
        : await this.deps.sessions.numbered.selected({
            guildId,
            channelId: channel.id,
            userId: session.identity.userId,
          });
    const advancedControls =
      channel !== null &&
      (await this.deps.featureGate.assistantV2({
        guildId,
        channelId: channel.id,
        userId: session.identity.userId,
      }));
    const sportsEnabled = await this.sportsEnabled(session, guildId);
    // Capture the view and its revision together after asynchronous gate checks.
    const handle =
      channel === null
        ? null
        : this.deps.sessions.getExisting(guildId, channel.id, playbackChannel);
    const view = handle?.view() ?? IDLE_VIEW;
    const source = view.current?.source;
    return {
      channel,
      playbackChannel: playbackChannel ?? null,
      playbackChannels:
        playbackChannel === undefined
          ? []
          : Array.from(
              { length: this.deps.sessions.numbered.maximum(guildId) },
              (_, index) => {
                const number = PlaybackChannelNumberSchema.parse(index + 1);
                return { number, label: playbackChannelLabel(number) };
              },
            ),
      revision:
        channel === null
          ? null
          : this.deps.sessions.revision(guildId, channel.id, playbackChannel),
      state: view.state,
      current:
        view.current === null ? null : this.playerItem(view.current, guildId),
      queue: view.queue.map((item) => this.playerItem(item, guildId)),
      positionSeconds: view.positionSeconds,
      paused: view.paused === true,
      volume: view.volume,
      loop: view.loop,
      advancedControls,
      sportsEnabled,
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

  private async target(session: WebSession, input: WebCommand) {
    await this.authorize(session, input.guildId, true);
    const guildId = GuildIdSchema.parse(input.guildId);
    const channelId = ChannelIdSchema.parse(input.channelId);
    const userId = UserIdSchema.parse(session.identity.userId);
    const scope = { guildId, channelId, userId };
    const playbackChannel = await this.deps.sessions.numbered.selected(scope);
    let revision = input.revision;
    const guard = () => {
      if (this.deps.bot.webVoiceChannel(guildId, userId)?.id !== channelId)
        throw new WebError(
          409,
          "channel_changed",
          "Your voice channel changed. Refresh and try again.",
        );
      if (
        (playbackChannel ?? null) !== input.playbackChannel ||
        (playbackChannel !== undefined &&
          this.deps.sessions.numbered.selection.get(scope) !== playbackChannel)
      )
        throw new WebError(
          409,
          "playback_channel_changed",
          "Your Streambot channel changed. Refresh and try again.",
        );
      if (
        this.deps.sessions.revision(guildId, channelId, playbackChannel) !==
        revision
      )
        throw new WebError(
          409,
          "playback_changed",
          "Playback or the queue changed. Refresh and try again.",
        );
    };
    guard();
    const refreshRevision = () => {
      revision = this.deps.sessions.revision(
        guildId,
        channelId,
        playbackChannel,
      );
    };
    return {
      guildId,
      channelId,
      userId,
      scope,
      playbackChannel,
      guard,
      refreshRevision,
    };
  }

  async selectChannel(
    session: WebSession,
    input: Extract<WebCommand, { action: "select" }>,
  ) {
    const { guildId, scope, playbackChannel, guard } = await this.target(
      session,
      input,
    );
    if (playbackChannel === undefined)
      throw new WebError(
        409,
        "channels_unavailable",
        "Numbered channels are unavailable while a legacy queue is active or the beta is disabled.",
      );
    const maximum = this.deps.sessions.numbered.maximum(guildId);
    if (input.number > maximum)
      throw new WebError(
        400,
        "invalid_channel",
        `Choose a Streambot channel from 1 to ${String(maximum)}.`,
      );
    guard();
    return {
      message: this.deps.sessions.numbered.selection.select(
        scope,
        input.number,
        maximum,
      ),
    };
  }

  async commandContext(session: WebSession, input: WebCommand) {
    const {
      guildId,
      channelId,
      userId,
      playbackChannel,
      guard,
      refreshRevision,
    } = await this.target(session, input);
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
    let handle = this.deps.sessions.getExisting(
      guildId,
      channelId,
      playbackChannel,
    );
    if (handle === null && input.action === "play") {
      handle = this.deps.sessions.ensureForPlay({
        guildId,
        voiceChannelId: channelId,
        statusChannelId: channelId,
        ...(playbackChannel === undefined ? {} : { playbackChannel }),
      });
      refreshRevision();
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
      refreshRevision();
      return result;
    };
    const service = new PlaybackCommandService({
      ...this.deps.commands,
      assertCurrent: guard,
      announce: (message) => this.deps.announce(channelId, message),
      guildId,
      channelId,
      ...(playbackChannel === undefined ? {} : { playbackChannel }),
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
      playbackChannel,
    };
  }
}
