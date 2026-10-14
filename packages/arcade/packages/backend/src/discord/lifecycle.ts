import { Events, type Client } from "discord.js";
import { AloneInVoiceWatcher } from "@shepherdjerred/discord-stream-lifecycle/session/auto-leave";
import type { createApplication } from "#src/web/application.ts";
import type { BotAccess } from "./access.ts";
import type { Logger } from "@shepherdjerred/discord-plays-core/logger.ts";

export function wireVoiceLifecycle(
  bot: Client,
  application: ReturnType<typeof createApplication>,
  access: BotAccess,
  logger: Logger,
): () => void {
  const watchers = new Map<string, AloneInVoiceWatcher>();
  const evaluate = () => {
    const sessions = application.manager.list();
    for (const [id, watcher] of watchers)
      if (
        !sessions.some(
          (session) =>
            session.id === id &&
            (session.phase === "running" || session.phase === "starting"),
        )
      ) {
        watcher.cancel();
        watchers.delete(id);
      }
    for (const session of sessions) {
      if (session.phase !== "running" && session.phase !== "starting") continue;
      let watcher = watchers.get(session.id);
      if (watcher === undefined) {
        watcher = new AloneInVoiceWatcher({ aloneGraceMs: 30_000, logger });
        watchers.set(session.id, watcher);
      }
      const people = access.players(session);
      const present = new Set(people.map((person) => person.discordId));
      for (const person of application.manager
        .room(session.guildId, session.gameId)
        .players())
        if (person !== null && !present.has(person.discordId))
          application.manager
            .room(session.guildId, session.gameId)
            .releaseUser(person.discordId);
      watcher.evaluate(
        { ...session, startedAt: new Date(session.startedAt) },
        {
          guildId: session.guildId,
          voiceChannelId: session.voiceChannelId,
          humanMemberCount: people.length,
        },
        () => {
          void (async () => {
            try {
              await application.manager.stopForSystem(
                session.id,
                "aloneInVoice",
              );
            } catch (error) {
              logger.error("auto-leave failed", error);
            }
          })();
        },
      );
      application.publish(session.guildId, session.gameId);
    }
  };
  bot.on(Events.VoiceStateUpdate, evaluate);
  const detachSessions = application.manager.onLifecycleChange(evaluate);
  evaluate();
  return () => {
    detachSessions();
    bot.off(Events.VoiceStateUpdate, evaluate);
    for (const watcher of watchers.values()) watcher.cancel();
    watchers.clear();
  };
}
