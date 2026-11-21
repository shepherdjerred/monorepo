import { PlaybackCommandService } from "@shepherdjerred/streambot/commands/playback-command-service.ts";
import type { PlaybackChannelNumber } from "@shepherdjerred/streambot/types/playback-channel.ts";
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
} from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { UnsupportedVideoRequestError } from "@shepherdjerred/streambot/sources/resolve.ts";
import type { WebSession } from "./session-store.ts";
import { WebError, requestInput } from "./errors.ts";
import type { WebPlaybackDeps } from "./playback-deps.ts";
import { WebHistory } from "./history.ts";
import { PlayReceipt, playEvent } from "./command/play-receipt.ts";
import {
  expectedCurrent,
  isPositional,
  targetPlaybackChannel,
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
  /** The play request's receipt, when the caller reports where the item went. */
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
   * The command's slot comes from the card it names or the slot its action implies. `guard`
   * re-checks that the viewer is still in the voice channel the command names before every
   * dispatch. Only positional commands also require the revision the viewer saw; everything else
   * applies to whatever is current when it lands.
   */
  private async target(session: WebSession, input: WebCommand) {
    await this.authorize(session, input.guildId);
    const guildId = GuildIdSchema.parse(input.guildId);
    const channelId = ChannelIdSchema.parse(input.channelId);
    const userId = UserIdSchema.parse(session.identity.userId);
    const scope = { guildId, channelId, userId };
    // A viewer with no numbered slot is in a legacy room: one mixed queue.
    const numbered =
      (await this.deps.sessions.numbered.selected(scope)) !== undefined;
    const playbackChannel = targetPlaybackChannel(input, numbered, () =>
      this.deps.sessions.numbered.maximum(guildId),
    );
    const positional = isPositional(input);
    let revision = input.revision;
    const guard = () => {
      if (this.deps.bot.webVoiceChannel(guildId, userId)?.id !== channelId)
        throw new WebError(
          409,
          "channel_changed",
          "Your voice channel changed. Refresh and try again.",
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
      guard,
      refreshRevision,
    };
  }

  async commandContext(
    session: WebSession,
    input: WebCommand,
    options: ContextOptions = {},
  ): Promise<WebCommandContext> {
    const receipt =
      options.receipt ??
      new PlayReceipt(input.action === "play" ? input.transport : undefined);
    const {
      guildId,
      channelId,
      userId,
      scope,
      playbackChannel,
      guard,
      refreshRevision,
    } = await this.target(session, input);
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
