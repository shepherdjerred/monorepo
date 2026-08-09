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

export function buildSessionHandle(
  config: Config,
  session: Session,
): SessionHandle {
  return {
    dispatch: (event) => {
      session.actor.send(event);
    },
    view: () =>
      buildPlaybackView(
        session.actor.getSnapshot(),
        session.entry.userbot.getPosition(),
      ),
    setVolume: (percent) => session.entry.userbot.setVolume(percent),
    seek: (seconds) => session.entry.userbot.seek(seconds),
    listSubtitleCandidates: (signal) => {
      const current = session.actor.getSnapshot().context.current;
      if (current === null) return Promise.resolve([]);
      return listSubtitleCandidatesForSource(config, current.source, signal);
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
