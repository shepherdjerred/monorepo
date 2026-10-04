import { CommandHandler } from "./command-handler.ts";
import type { CommandHandlerDeps } from "./command-types.ts";
import type { SessionHandle } from "@shepherdjerred/streambot/session/session-types.ts";
import type { PlaybackCommandServiceDeps } from "@shepherdjerred/streambot/commands/playback-command-types.ts";
export type HandlerOptions = {
  guildId?: string;
  channelId?: string | null;
  routed?: PlaybackCommandServiceDeps;
  announce: (message: string) => Promise<void>;
};
export function createCommandHandler(
  deps: Pick<
    CommandHandlerDeps,
    | "config"
    | "library"
    | "expandPlaylist"
    | "listSources"
    | "resolvePlaySource"
    | "discovery"
    | "history"
    | "featureGate"
    | "sports"
  >,
  handle: SessionHandle,
  options: HandlerOptions,
): CommandHandler {
  const { guildId, channelId, routed } = options;
  return new CommandHandler({
    ...(handle.playbackChannel === undefined
      ? {}
      : { playbackChannel: handle.playbackChannel }),
    config: deps.config,
    dispatch: handle.dispatch,
    view: handle.view,
    library: deps.library,
    setVolume: handle.setVolume,
    seek: handle.seek,
    expandPlaylist: deps.expandPlaylist,
    listSources: deps.listSources,
    resolvePlaySource: deps.resolvePlaySource,
    announce: options.announce,
    listSubtitleCandidates: handle.listSubtitleCandidates,
    currentSourceId: handle.currentSourceId,
    hasPendingSubtitleMenu: handle.hasPendingSubtitleMenu,
    claimSubtitleMenu: handle.claimSubtitleMenu,
    releaseSubtitleMenu: handle.releaseSubtitleMenu,
    startVoiceDebugCapture: handle.startVoiceDebugCapture,
    stopVoiceDebugCapture: handle.stopVoiceDebugCapture,
    voiceDebugCaptureStatus: handle.voiceDebugCaptureStatus,
    ...(deps.discovery === undefined ? {} : { discovery: deps.discovery }),
    ...(deps.history === undefined ? {} : { history: deps.history }),
    ...(guildId === undefined ? {} : { guildId }),
    ...(channelId == null ? {} : { channelId }),
    ...(deps.featureGate === undefined
      ? {}
      : { featureGate: deps.featureGate }),
    ...(deps.sports === undefined ? {} : { sports: deps.sports }),
    ...(routed === undefined ? {} : { ...routed, config: deps.config }),
  });
}
