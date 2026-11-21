/**
 * Projection of a live {@link Session} into the {@link SessionHandle} the command handler and the
 * player card drive. Extracted from `session-manager.ts` so that file stays under the 500-line
 * `max-lines` cap, and so the projection has one obvious home.
 */
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import { buildPlaybackView } from "@shepherdjerred/streambot/machine/view.ts";
import { sourceIdentity } from "@shepherdjerred/streambot/sources/source.ts";
import { listSubtitleCandidatesForSource } from "@shepherdjerred/streambot/sources/subtitle-candidates.ts";
import type {
  Session,
  SessionHandle,
} from "@shepherdjerred/streambot/session/session-types.ts";
import type { StationFeeder } from "@shepherdjerred/streambot/station/station-feeder.ts";
import { PlaybackCommandBoundaryError } from "@shepherdjerred/streambot/commands/playback-command-errors.ts";
import { queuedDisplay } from "./queued-display.ts";
import { itemTokens, locateDispatched, queueEntries } from "./item-tokens.ts";

export function buildSessionHandle(
  config: Config,
  session: Session,
  feeder?: StationFeeder,
): SessionHandle {
  const dispatch: SessionHandle["dispatch"] = (event) => {
    if (session.torndown)
      throw new PlaybackCommandBoundaryError(
        "That playback ended while the command was loading. Try again.",
      );
    feeder?.onBeforeDispatch(session, event);
    session.actor.send(
      event.type === "ADD" ||
        event.type === "ADD_NEXT" ||
        event.type === "PLAY_NOW"
        ? {
            ...event,
            queuedAt: event.queuedAt ?? Date.now(),
            display: queuedDisplay(event),
          }
        : event,
    );
  };
  return {
    ...(session.playbackChannel === undefined
      ? {}
      : { playbackChannel: session.playbackChannel }),
    ...(session.instanceId === undefined
      ? {}
      : { instanceId: session.instanceId }),
    dispatch,
    dispatchTracked: (event) => {
      const before = queueEntries(session.actor.getSnapshot().context);
      dispatch(event);
      return locateDispatched(
        session.actor,
        before,
        session.actor.getSnapshot().context,
      );
    },
    itemTokens: () =>
      itemTokens(session.actor, session.actor.getSnapshot().context),
    view: () =>
      buildPlaybackView(
        session.actor.getSnapshot(),
        session.entry.userbot.getPosition(),
      ),
    station: () => session.station ?? null,
    setVolume: (percent) => session.entry.userbot.setVolume(percent),
    seek: (seconds) => session.seek(seconds),
    assistantUserId: () => session.entry.userbot.assistantUserId(),
    assistantDaveReady: () => session.entry.userbot.assistantDaveReady(),
    startVoiceDebugCapture: (durationSeconds) =>
      session.voiceAssistant?.startDebugCapture(durationSeconds) ?? {
        outcome: "disabled",
      },
    stopVoiceDebugCapture: () =>
      session.voiceAssistant?.stopDebugCapture() ?? { outcome: "none" },
    voiceDebugCaptureStatus: () =>
      session.voiceAssistant?.debugCaptureStatus() ?? null,
    listSubtitleCandidates: (signal) => {
      const current = session.actor.getSnapshot().context.current;
      return current === null
        ? Promise.resolve([])
        : listSubtitleCandidatesForSource(config, current.source, signal);
    },
    currentSourceId: () => {
      const current = session.actor.getSnapshot().context.current;
      return current === null ? null : sourceIdentity(current.source);
    },
    hasPendingSubtitleMenu: () => session.pendingSubtitleMenu,
    claimSubtitleMenu: () => {
      if (session.pendingSubtitleMenu) return false;
      session.pendingSubtitleMenu = true;
      return true;
    },
    releaseSubtitleMenu: () => {
      session.pendingSubtitleMenu = false;
    },
  };
}
