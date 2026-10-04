import type { PlaybackCommandServiceDeps } from "@shepherdjerred/streambot/commands/playback-command-types.ts";
import { automaticPlaybackChannel } from "@shepherdjerred/streambot/commands/automatic-channel.ts";
import { PlaybackCommandBoundaryError } from "@shepherdjerred/streambot/commands/playback-command-errors.ts";
import { buildSessionHandle } from "./session-handle.ts";
import { sessionRevision } from "./session-revision.ts";
import {
  EMPTY_HANDLE,
  type Session,
  type SessionHandle,
} from "./session-types.ts";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import type { DiscoveryScope } from "@shepherdjerred/streambot/discovery/candidate.ts";
import {
  PlaybackChannelNumberSchema,
  type PlaybackChannelNumber,
} from "@shepherdjerred/streambot/types/playback-channel.ts";
import type { ChannelSelection } from "./channel-selection.ts";

export function numberedCommandDeps(input: {
  common: PlaybackCommandServiceDeps;
  config: Config;
  scope: DiscoveryScope;
  selection: ChannelSelection;
  maximum: number;
  automatic: boolean;
  get: (number: PlaybackChannelNumber) => Session | undefined;
  ensure: (number: PlaybackChannelNumber) => SessionHandle | null;
}) {
  const { common, scope, selection } = input;
  const selectionVersion = selection.version(scope);
  const starts = new Map<
    number,
    { session: Session | undefined; revision: string | null }
  >();
  function captureSlots() {
    for (let number = 1; number <= input.maximum; number++) {
      const session = input.get(PlaybackChannelNumberSchema.parse(number));
      starts.set(number, {
        session,
        revision: session === undefined ? null : sessionRevision(session),
      });
    }
  }
  captureSlots();
  const assertSelection = () => {
    if (selection.version(scope) !== selectionVersion)
      throw new PlaybackCommandBoundaryError(
        "Your Streambot channel selection changed while the command was loading. Try again.",
      );
  };
  function bind(number: PlaybackChannelNumber): PlaybackCommandServiceDeps {
    const captured = starts.get(number);
    if (captured === undefined)
      throw new PlaybackCommandBoundaryError(
        "That Streambot channel is unavailable.",
      );
    let { session, revision } = captured;
    const guard = () => {
      assertSelection();
      const current = input.get(number);
      if (
        current !== session ||
        (current === undefined ? null : sessionRevision(current)) !== revision
      )
        throw new PlaybackCommandBoundaryError(
          "Playback changed while the command was loading. Try again.",
        );
    };
    const handle = () => {
      guard();
      return session === undefined
        ? EMPTY_HANDLE
        : buildSessionHandle(input.config, session);
    };
    return {
      ...common,
      playbackChannel: number,
      assertCurrent: guard,
      view: () => handle().view(),
      setVolume: (percent) => handle().setVolume(percent),
      seek: (seconds) => handle().seek(seconds),
      dispatch: (event) => {
        guard();
        const active =
          session === undefined
            ? input.ensure(number)
            : buildSessionHandle(input.config, session);
        if (active === null)
          throw new PlaybackCommandBoundaryError(
            "No stream bots are available for this channel.",
          );
        active.dispatch(event);
        session = input.get(number);
        revision = session === undefined ? null : sessionRevision(session);
        starts.set(number, { session, revision });
        if (input.automatic) selection.follow(scope, number);
      },
    };
  }
  const selected = bind(selection.get(scope));
  return input.automatic
    ? ({
        ...selected,
        assertCurrent: assertSelection,
        preparePlayback: () => {
          assertSelection();
          captureSlots();
        },
        routePlayback: (source, resolved, userId) => {
          assertSelection();
          if (userId !== scope.userId)
            throw new PlaybackCommandBoundaryError(
              "The requester changed while loading playback.",
            );
          return Promise.resolve(
            bind(automaticPlaybackChannel(source, resolved)),
          );
        },
      } satisfies PlaybackCommandServiceDeps)
    : selected;
}
