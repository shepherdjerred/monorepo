import { PlaybackCommandService } from "@shepherdjerred/streambot/commands/playback-command-service.ts";
import {
  PlaybackChannelNumberSchema,
  type PlaybackChannelNumber,
} from "@shepherdjerred/streambot/types/playback-channel.ts";
import type { SessionHandle } from "@shepherdjerred/streambot/session/session-types.ts";
import {
  IDLE_VIEW,
  EMPTY_HANDLE,
} from "@shepherdjerred/streambot/session/session-types.ts";
import type { PlaybackCommandServiceDeps } from "@shepherdjerred/streambot/commands/playback-command-types.ts";
import {
  ChannelIdSchema,
  GuildIdSchema,
  UserIdSchema,
  type ChannelId,
  type GuildId,
  type UserId,
} from "@shepherdjerred/streambot/types/ids.ts";
import type {
  WebCommand,
  WebSnapshot,
} from "@shepherdjerred/streambot/web/shared/contracts.ts";
import type { WebSession } from "./session-store.ts";
import { WebError, requestInput } from "./errors.ts";
import type { WebPlaybackDeps } from "./playback-deps.ts";
import { WebHistory } from "./history.ts";
import { buildWebSnapshot } from "./snapshot.ts";
import { automaticPlaybackChannel } from "@shepherdjerred/streambot/commands/automatic-channel.ts";

type WebCommandContext = {
  handle: SessionHandle;
  commandDeps: PlaybackCommandServiceDeps;
  service: PlaybackCommandService;
  guard: () => void;
  guarded: <T>(action: () => T) => T;
  userId: UserId;
  guildId: GuildId;
  channelId: ChannelId;
  playbackChannel: PlaybackChannelNumber | undefined;
};

export class WebPlayback {
  readonly history: WebHistory;
  constructor(readonly deps: WebPlaybackDeps) {
    this.history = new WebHistory(deps.commands.history, deps.commands.sports);
  }

  requesterName(
    session: WebSession,
    guildId: string,
    userId: string,
  ): Promise<string> {
    return userId === session.identity.userId
      ? Promise.resolve(session.identity.username)
      : (this.deps.bot.webRequesterName?.(guildId, userId) ??
          Promise.resolve("User " + userId));
  }

  async historyEnabled(session: WebSession, guildId: string): Promise<boolean> {
    return (
      this.deps.commands.history !== undefined &&
      (await this.deps.featureGate.history({
        guildId,
        userId: session.identity.userId,
        channelId: "web",
      }))
    );
  }

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

  async snapshot(
    session: WebSession,
    guild: string,
    viewedSlot?: string | null,
  ): Promise<WebSnapshot> {
    return await buildWebSnapshot(this, session, guild, viewedSlot);
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

  private async target(session: WebSession, input: WebCommand, routed = false) {
    await this.authorize(session, input.guildId);
    const guildId = GuildIdSchema.parse(input.guildId);
    const channelId = ChannelIdSchema.parse(input.channelId);
    const userId = UserIdSchema.parse(session.identity.userId);
    const scope = { guildId, channelId, userId };
    const selected = await this.deps.sessions.numbered.selected(scope);
    const playbackChannel =
      selected === undefined || input.playbackChannel === null
        ? selected
        : requestInput(PlaybackChannelNumberSchema, input.playbackChannel);
    if (
      playbackChannel !== undefined &&
      playbackChannel > this.deps.sessions.numbered.maximum(guildId)
    )
      throw new WebError(
        400,
        "invalid_channel",
        "That Streambot channel is unavailable.",
      );
    const selectionVersion =
      input.selectionVersion ??
      this.deps.sessions.numbered.selection.version(scope);
    let revision = input.revision;
    const guard = () => {
      if (this.deps.bot.webVoiceChannel(guildId, userId)?.id !== channelId)
        throw new WebError(
          409,
          "channel_changed",
          "Your voice channel changed. Refresh and try again.",
        );
      if (
        this.deps.sessions.numbered.selection.version(scope) !==
          selectionVersion ||
        (!routed &&
          input.selectionVersion === null &&
          ((selected ?? null) !== input.playbackChannel ||
            (selected !== undefined &&
              this.deps.sessions.numbered.selection.get(scope) !== selected)))
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
    if (input.number !== null && input.number > maximum)
      throw new WebError(
        400,
        "invalid_channel",
        `Choose a Streambot channel from 1 to ${String(maximum)}.`,
      );
    guard();
    if (input.number === null) {
      if (
        (await this.deps.featureGate.automaticChannelRouting?.(scope)) !== true
      )
        throw new WebError(
          403,
          "feature_disabled",
          "Automatic channels are not enabled here.",
        );
      guard();
      this.deps.sessions.numbered.selection.clear(scope);
      return {
        message:
          "Automatic channels selected: music uses 1; Plex and sports use 2.",
      };
    }
    return {
      message: this.deps.sessions.numbered.selection.select(
        scope,
        input.number,
        maximum,
      ),
    };
  }

  private manualDestination(
    input: WebCommand,
    scope: { guildId: string; channelId: string; userId: string },
    viewed: PlaybackChannelNumber | undefined,
  ): WebCommand | null {
    if (
      viewed === undefined ||
      input.action !== "play" ||
      !this.deps.sessions.numbered.selection.isManual(scope)
    )
      return null;
    const selected = this.deps.sessions.numbered.selection.get(scope);
    if (selected === viewed) return null;
    const revision = input.slotRevisions[String(selected)];
    if (revision === undefined)
      throw new WebError(
        409,
        "playback_changed",
        "Refresh playback before choosing a destination.",
      );
    return { ...input, playbackChannel: selected, revision };
  }

  async commandContext(
    session: WebSession,
    input: WebCommand,
    routed = false,
  ): Promise<WebCommandContext> {
    const {
      guildId,
      channelId,
      userId,
      scope,
      playbackChannel,
      guard,
      refreshRevision,
    } = await this.target(session, input, routed);
    const manual = routed
      ? null
      : this.manualDestination(input, scope, playbackChannel);
    if (manual !== null) {
      guard();
      return await this.commandContext(session, manual, true);
    }
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
    if (handle === null && input.action !== "play")
      throw new WebError(
        409,
        "no_session",
        "Nothing is playing in your voice channel.",
      );
    const boundHandle = () => handle;
    const guarded = <T>(action: () => T): T => {
      guard();
      const result = action();
      refreshRevision();
      return result;
    };
    const automatic =
      !routed &&
      input.action === "play" &&
      playbackChannel !== undefined &&
      !this.deps.sessions.numbered.selection.isManual({
        guildId,
        channelId,
        userId,
      }) &&
      (await this.deps.featureGate.automaticChannelRouting?.({
        guildId,
        channelId,
        userId,
      })) === true;
    guard();
    const commandDeps: PlaybackCommandServiceDeps = {
      ...this.deps.commands,
      assertCurrent: guard,
      announce: (message) => this.deps.announce(channelId, message),
      guildId,
      channelId,
      ...(playbackChannel === undefined ? {} : { playbackChannel }),
      ...(automatic
        ? {
            routePlayback: async (source, resolved, actor) => {
              guard();
              if (actor !== userId)
                throw new WebError(
                  403,
                  "requester_changed",
                  "The requester changed while loading playback.",
                );
              const number = automaticPlaybackChannel(source, resolved);
              const revision = input.slotRevisions[String(number)];
              if (revision === undefined)
                throw new WebError(
                  409,
                  "playback_changed",
                  "Refresh playback before choosing a destination.",
                );
              const destination = await this.commandContext(
                session,
                { ...input, playbackChannel: number, revision },
                true,
              );
              return destination.commandDeps;
            },
          }
        : {}),
      dispatch: (event) => {
        guarded(() => {
          if (handle === null) {
            handle = this.deps.sessions.ensureForPlay({
              guildId,
              voiceChannelId: channelId,
              statusChannelId: channelId,
              ...(playbackChannel === undefined ? {} : { playbackChannel }),
            });
            if (handle === null)
              throw new WebError(
                409,
                "no_session",
                "No stream bots are available right now.",
              );
          }
          handle.dispatch(event);
          if (routed && playbackChannel !== undefined)
            this.deps.sessions.numbered.selection.follow(
              { guildId, channelId, userId },
              playbackChannel,
            );
        });
      },
      view: () => boundHandle()?.view() ?? IDLE_VIEW,
      setVolume: (percent) =>
        guarded(
          () => boundHandle()?.setVolume(percent) ?? Promise.resolve(false),
        ),
      seek: (seconds) =>
        guarded(() => boundHandle()?.seek(seconds) ?? Promise.resolve(false)),
      authorization: {
        controlItem: (actor) =>
          actor === userId &&
          this.deps.bot.webVoiceChannel(guildId, actor)?.id === channelId,
        manageQueue: (actor) =>
          actor === userId &&
          this.deps.bot.webVoiceChannel(guildId, actor)?.id === channelId,
      },
    };
    const service = new PlaybackCommandService(commandDeps);
    return {
      handle: handle ?? EMPTY_HANDLE,
      commandDeps,
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
