import type { SubtitleTrackRef } from "@shepherdjerred/streambot/sources/source.ts";
import {
  subtitleTrackRef,
  type SubtitleCandidate,
} from "@shepherdjerred/streambot/sources/subtitles.ts";
import type { WebCommand } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import type { WebSession } from "./session-store.ts";
import { Selections, SELECTIONS_PER_OWNER } from "./selections.ts";
import { WebError } from "./errors.ts";
import type { WebPlayback } from "./playback.ts";

type TrackSelection = {
  sourceId: string;
  revision: string;
  track: SubtitleTrackRef;
};

export class WebActions {
  private readonly tracks = new Selections<TrackSelection>(2 * 60 * 1000);
  constructor(private readonly playback: WebPlayback) {}

  async execute(
    session: WebSession,
    input: WebCommand,
    signal: AbortSignal,
  ): Promise<{ message: string }> {
    if (input.action === "select")
      return await this.playback.selectChannel(session, input);
    if (input.action === "play") return await this.play(session, input, signal);
    const context = await this.playback.commandContext(session, input);
    const { service, userId, handle } = context;
    try {
      switch (input.action) {
        case "pause":
          return service.pause(userId);
        case "resume":
          return service.resume(userId);
        case "skip":
          return service.skip(userId);
        case "stop":
          return service.stop(userId);
        case "clear":
          return service.clear(userId);
        case "shuffle":
          return service.shuffle();
        case "seek":
          return await service.seek(userId, input.seconds, false);
        case "volume":
          return await service.setVolume(input.percent);
        case "loop":
          return service.setLoop(input.mode);
        case "remove":
          return service.remove(userId, input.position);
        case "move":
          return service.move(input.from, input.to);
        case "subtitles": {
          const selected = this.tracks.get(
            session.key + ":" + input.guildId,
            input.token,
          );
          context.guard();
          if (
            selected.revision !== input.revision ||
            selected.sourceId !== handle.currentSourceId()
          )
            throw new WebError(
              409,
              "playback_changed",
              "Playback changed while you were choosing subtitles. Open the picker again.",
            );
          service.applySubtitleTrack(userId, selected.track);
          return {
            message:
              "Restarting at the current position with the selected subtitles.",
          };
        }
      }
    } finally {
      this.playback.deps.sessions.releaseUnused(
        context.guildId,
        context.channelId,
        context.playbackChannel,
      );
    }
  }

  private async play(
    session: WebSession,
    input: Extract<WebCommand, { action: "play" }>,
    signal: AbortSignal,
  ) {
    await this.playback.authorize(session, input.guildId);
    const owner = session.key + ":" + input.guildId;
    if (
      input.selection.kind === "history" &&
      !(await this.playback.historyEnabled(session, input.guildId))
    )
      throw new WebError(
        403,
        "history_disabled",
        "Playback history is not enabled here.",
      );
    // Expired selections and ended sports fail before acquiring a playback actor.
    const selected =
      input.selection.kind === "history"
        ? await this.playback.history.select(input.selection.id, owner, signal)
        : this.playback.deps.catalog.select(input.selection, owner);
    const context = await this.playback.commandContext(session, input);
    try {
      return await context.service.play({
        query: selected.title,
        source: "auto",
        placement: input.placement,
        userId: context.userId,
        sourceOverride: selected.source,
        spoken: false,
        signal,
      });
    } finally {
      this.playback.deps.sessions.releaseUnused(
        context.guildId,
        context.channelId,
        context.playbackChannel,
      );
    }
  }

  async subtitles(session: WebSession, input: WebCommand, signal: AbortSignal) {
    if (input.action !== "subtitles")
      throw new WebError(400, "invalid_request", "Choose a subtitle action.");
    const { handle, guard } = await this.playback.commandContext(
      session,
      input,
    );
    const view = handle.view();
    const sourceId = handle.currentSourceId();
    if (
      sourceId === null ||
      input.revision === null ||
      view.current?.mediaKind !== "video" ||
      view.paused === true
    )
      throw new WebError(
        409,
        "subtitles_unavailable",
        "Subtitles are available while a video is playing.",
      );
    if (!handle.claimSubtitleMenu())
      throw new WebError(
        409,
        "subtitle_picker_busy",
        "Another subtitle picker is open. Try again shortly.",
      );
    try {
      const candidates = await handle.listSubtitleCandidates(
        AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      );
      guard();
      if (sourceId !== handle.currentSourceId())
        throw new WebError(
          409,
          "playback_changed",
          "Playback changed. Open the picker again.",
        );
      const owner = session.key + ":" + input.guildId;
      const revision = input.revision;
      return {
        revision,
        tracks: [
          {
            token: this.tracks.add(owner, {
              sourceId,
              revision,
              track: { kind: "off" },
            }),
            label: "Off",
          },
          // Reserve one selection for Off before allocating the visible tracks.
          ...candidates.slice(0, SELECTIONS_PER_OWNER - 1).map((candidate) => ({
            token: this.tracks.add(owner, {
              sourceId,
              revision,
              track: subtitleTrackRef(candidate),
            }),
            label: candidateLabel(candidate),
          })),
        ],
      };
    } finally {
      handle.releaseSubtitleMenu();
    }
  }
}

function candidateLabel(candidate: SubtitleCandidate): string {
  return (
    (candidate.lang ?? "Unknown language") +
    (candidate.kind === "ytdlp" && candidate.autoGenerated
      ? " · automatic"
      : "") +
    (candidate.modifier === null ? "" : " · " + candidate.modifier) +
    " · " +
    candidate.kind
  );
}
