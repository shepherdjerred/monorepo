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
  WebCommandResult,
  WebSnapshot,
} from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { UnsupportedVideoRequestError } from "@shepherdjerred/streambot/sources/resolve.ts";
import type { WebSession } from "./session-store.ts";
import { WebError, requestInput } from "./errors.ts";
import type { WebPlaybackDeps } from "./playback-deps.ts";
import { WebHistory } from "./history.ts";
import { buildWebSnapshot } from "./snapshot.ts";
import { automaticPlaybackChannel } from "@shepherdjerred/streambot/commands/automatic-channel.ts";
import { PlayReceipt, playEvent } from "./command/play-receipt.ts";
import {
  expectedCurrent,
  explicitPlaybackChannel,
  isExplicitTarget,
  isPositional,
} from "./command/targeting.ts";

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
  receipt: PlayReceipt;
  /** A play command's response: the message plus where its first item went. */
  playResult: (message: string) => WebCommandResult;
};

type ContextOptions = {
  /** The destination automatic routing chose for a parent play command. */
  readonly routed?: boolean;
  /** Bind a command that is not one of the positional actions to the viewer's revision. */
  readonly positional?: boolean;
  /** Shared with a routed child so the parent reports where the item went. */
  readonly receipt?: PlayReceipt;
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

  async snapshot(session: WebSession, guild: string): Promise<WebSnapshot> {
    return await buildWebSnapshot(this, session, guild);
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

  resolveTarget(session: WebSession, input: WebCommand) {
    return this.target(session, input);
  }

  /** The viewer's current Discord voice channel name, returned only to that viewer. */
  voiceChannelName(guildId: GuildId, userId: UserId): string | undefined {
    return this.deps.bot.webVoiceChannel(guildId, userId)?.name;
  }

  /**
   * `guard` re-checks the target (same voice channel and, for selection-based commands, the same
   * personal selection) before every dispatch. Only positional commands also require the revision
   * the viewer saw; everything else applies to whatever is current when it lands.
   */
  private async target(
    session: WebSession,
    input: WebCommand,
    options: ContextOptions = {},
  ) {
    const routed = options.routed === true;
    await this.authorize(session, input.guildId);
    const guildId = GuildIdSchema.parse(input.guildId);
    const channelId = ChannelIdSchema.parse(input.channelId);
    const userId = UserIdSchema.parse(session.identity.userId);
    const scope = { guildId, channelId, userId };
    const selected = await this.deps.sessions.numbered.selected(scope);
    const explicit = isExplicitTarget(input);
    const playbackChannel = explicit
      ? explicitPlaybackChannel(input, selected !== undefined, () =>
          this.deps.sessions.numbered.maximum(guildId),
        )
      : this.selectedChannel(input, selected, guildId);
    const selectionVersion =
      input.selectionVersion ??
      this.deps.sessions.numbered.selection.version(scope);
    const auto =
      !explicit &&
      selected !== undefined &&
      !this.deps.sessions.numbered.selection.isManual(scope) &&
      (await this.deps.featureGate.automaticChannelRouting?.(scope)) === true;
    const positional = options.positional === true || isPositional(input);
    let revision = input.revision;
    const guard = () => {
      if (this.deps.bot.webVoiceChannel(guildId, userId)?.id !== channelId)
        throw new WebError(
          409,
          "channel_changed",
          "Your voice channel changed. Refresh and try again.",
        );
      if (
        !explicit &&
        (this.deps.sessions.numbered.selection.version(scope) !==
          selectionVersion ||
          (!routed &&
            (!auto || input.selectionVersion === null) &&
            (((input.selectionVersion === null ||
              input.playbackChannel !== null) &&
              (selected ?? null) !== input.playbackChannel) ||
              (selected !== undefined &&
                this.deps.sessions.numbered.selection.get(scope) !==
                  selected))))
      )
        throw new WebError(
          409,
          "playback_channel_changed",
          "Your Streambot channel changed. Refresh and try again.",
        );
      if (
        positional &&
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
      auto,
      guard,
      refreshRevision,
    };
  }

  private selectedChannel(
    input: WebCommand,
    selected: PlaybackChannelNumber | undefined,
    guildId: GuildId,
  ): PlaybackChannelNumber | undefined {
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
    return playbackChannel;
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

  async commandContext(
    session: WebSession,
    input: WebCommand,
    options: ContextOptions = {},
  ): Promise<WebCommandContext> {
    const routed = options.routed === true;
    const receipt =
      options.receipt ??
      new PlayReceipt(input.action === "play" ? input.transport : undefined);
    const {
      guildId,
      channelId,
      userId,
      scope,
      playbackChannel,
      auto,
      guard,
      refreshRevision,
    } = await this.target(session, input, options);
    if (
      input.action === "play" &&
      input.transport === "listen" &&
      !(await this.deps.featureGate.musicOverVoice(scope))
    )
      throw new WebError(
        409,
        "listen_disabled",
        "Listening in the voice channel is not enabled in this server. Choose Watch instead.",
      );
    if (
      (["pause", "resume"].includes(input.action) ||
        (input.action === "play" && input.placement === "now")) &&
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
    const expected = expectedCurrent(input);
    const guardCommand = () => {
      guard();
      if (
        expected !== undefined &&
        (handle?.itemTokens().current ?? null) !== expected
      )
        throw new WebError(409, "item_finished", "That item already finished.");
    };
    const boundHandle = () => handle;
    const guarded = <T>(action: () => T): T => {
      guardCommand();
      const result = action();
      refreshRevision();
      return result;
    };
    const automatic = !routed && input.action === "play" && auto;
    guardCommand();
    const commandDeps: PlaybackCommandServiceDeps = {
      ...this.deps.commands,
      assertCurrent: guardCommand,
      announce: (message) => this.deps.announce(channelId, message),
      guildId,
      channelId,
      ...(playbackChannel === undefined ? {} : { playbackChannel }),
      resolvePlaySource: async (source, signal) => {
        try {
          return await this.deps.commands.resolvePlaySource(source, signal);
        } catch (error) {
          if (error instanceof UnsupportedVideoRequestError)
            receipt.noVideo = true;
          throw error;
        }
      },
      ...(automatic
        ? {
            routePlayback: async (source, resolved, actor) => {
              guardCommand();
              if (actor !== userId)
                throw new WebError(
                  403,
                  "requester_changed",
                  "The requester changed while loading playback.",
                );
              const number = automaticPlaybackChannel(source, resolved);
              const destination = await this.commandContext(
                session,
                { ...input, playbackChannel: number },
                { routed: true, receipt },
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
          const play = playEvent(event);
          if (play === null) handle.dispatch(event);
          else
            receipt.record(play, playbackChannel, handle.dispatchTracked(play));
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
      guard: guardCommand,
      guarded,
      userId,
      guildId,
      channelId,
      playbackChannel,
      receipt,
      playResult: (message) => ({
        message,
        ...receipt.result(this.voiceChannelName(guildId, userId)),
      }),
    };
  }
}
