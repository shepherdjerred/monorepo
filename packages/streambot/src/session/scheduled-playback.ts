import type { SessionManager } from "./session-manager.ts";
import type { SchedulePorts } from "@shepherdjerred/streambot/sports/playback-schedules.ts";
import type { ScheduleTarget } from "@shepherdjerred/streambot/sports/schedule-types.ts";
import type { Source } from "@shepherdjerred/streambot/sources/source.ts";
import type { ResolvedSource } from "@shepherdjerred/streambot/machine/types.ts";
import {
  GuildIdSchema,
  ChannelIdSchema,
  UserIdSchema,
} from "@shepherdjerred/streambot/types/ids.ts";
import { PlaybackChannelNumberSchema } from "@shepherdjerred/streambot/types/playback-channel.ts";

export function scheduledPlaybackPorts(input: {
  sessions: Pick<
    SessionManager,
    "getExisting" | "ensureForPlay" | "releaseUnused"
  >;
  allowed: SchedulePorts["allowed"];
  authority: SchedulePorts["authority"];
  resolve: (source: Source, signal: AbortSignal) => Promise<ResolvedSource>;
}): SchedulePorts {
  const handle = (t: ScheduleTarget) =>
    input.sessions.getExisting(
      GuildIdSchema.parse(t.guildId),
      ChannelIdSchema.parse(t.channelId),
      PlaybackChannelNumberSchema.parse(t.slot),
    );
  return {
    allowed: input.allowed,
    authority: input.authority,
    slot: (target) => {
      const view = handle(target)?.view();
      const source = view?.current?.source ?? view?.queue[0]?.source;
      return {
        idle:
          view === undefined ||
          (view.current === null &&
            view.queue.length === 0 &&
            view.state === "idle"),
        ...(source?.kind === "url" && source.scheduleId !== undefined
          ? { scheduleId: source.scheduleId }
          : {}),
      };
    },
    stop: (schedule) => {
      const current = handle(schedule.target);
      const view = current?.view();
      const source = view?.current?.source;
      if (source?.kind === "url" && source.scheduleId === schedule.id)
        current?.dispatch({ type: "SKIP" });
      else {
        const index =
          view?.queue.findIndex(
            (item) =>
              item.source?.kind === "url" &&
              item.source.scheduleId === schedule.id,
          ) ?? -1;
        if (index >= 0) current?.dispatch({ type: "REMOVE", index });
      }
    },
    start: async (schedule, signal, claim) => {
      const source: Source = {
        kind: "url",
        url: schedule.event.pageUrl,
        sportsEvent: schedule.event,
        scheduleId: schedule.id,
        mode: "video",
      };
      const preResolved = await input.resolve(source, signal);
      if (!(await input.allowed(schedule.target))) return "busy";
      const authority = await input.authority(schedule.target);
      if (!authority.allowed || !authority.listeners) return "busy";
      const target = schedule.target;
      const h = input.sessions.ensureForPlay({
        guildId: GuildIdSchema.parse(target.guildId),
        voiceChannelId: ChannelIdSchema.parse(target.channelId),
        statusChannelId: ChannelIdSchema.parse(target.statusChannelId),
        playbackChannel: PlaybackChannelNumberSchema.parse(target.slot),
      });
      if (h === null) return "capacity";
      try {
        if (!claim()) return "busy";
        h.dispatch({
          type: "PLAY_NOW",
          source,
          preResolved,
          requesterId: UserIdSchema.parse(target.userId),
        });
        return "started";
      } finally {
        input.sessions.releaseUnused(
          GuildIdSchema.parse(target.guildId),
          ChannelIdSchema.parse(target.channelId),
          PlaybackChannelNumberSchema.parse(target.slot),
        );
      }
    },
  };
}
