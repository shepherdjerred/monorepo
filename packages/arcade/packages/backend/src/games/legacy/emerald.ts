import type { Client } from "discord.js";
import { games } from "@arcade/common/catalog.ts";
import { UserError } from "#src/errors.ts";
import {
  PokemonStateSchema,
  type PokemonState,
} from "@arcade/common/telemetry.ts";
import {
  PokemonGameDriver,
  POKEMON_SAVE_HISTORY_ENTRIES,
} from "@discord-plays-pokemon/backend/lifecycle/pokemon-driver.ts";
import type { RuntimeConfig as Config } from "@discord-plays-pokemon/backend/config/schema.ts";
import { readGameStateView } from "@discord-plays-pokemon/backend/game/state-view.ts";
import { describeGameEvent } from "@discord-plays-pokemon/backend/game/events/describe.ts";
import {
  WIDTH,
  HEIGHT,
  GBA_FPS,
  AUDIO_SAMPLE_RATE,
  AUDIO_CHANNELS,
  DISPLAY_ASPECT,
} from "@discord-plays-pokemon/backend/emulator/constants.ts";
import {
  createPlayPolicy,
  playersInVoice,
} from "@discord-plays-pokemon/backend/webserver/play-policy.ts";
import { runInteractiveCommand } from "@discord-plays-pokemon/backend/webserver/dispatch.ts";
import { handleMessages } from "@discord-plays-pokemon/backend/discord/message-handler.ts";
import { enqueueCommand } from "@discord-plays-pokemon/backend/emulator/command-sink.ts";
import { botVoicePresence } from "@shepherdjerred/discord-plays-core/auth/voice-presence.ts";
import { encodePng } from "@shepherdjerred/discord-plays-core/image/png.ts";
import type { SelfbotPooledUserbot } from "@shepherdjerred/discord-stream-lifecycle/pool/selfbot-client";
import type { GameServerModule } from "#src/games/module.ts";
import type { MediaFeeds } from "#src/media/feeds.ts";
import type { StatsStore } from "#src/stats/store.ts";

export function emeraldModule(options: {
  bot: Client;
  config: Config;
  goalGuildIds: ReadonlySet<string>;
  excludedUserIds: ReadonlySet<string>;
  feeds: MediaFeeds;
  stats: StatsStore;
  statsChanged: (guildId: string) => void;
}): GameServerModule<SelfbotPooledUserbot> {
  return {
    definition: games.emerald,
    saveEntries: POKEMON_SAVE_HISTORY_ENTRIES,
    create(context) {
      const feed = options.feeds.create(
        context.session.id,
        {
          width: WIDTH,
          height: HEIGHT,
          fps: GBA_FPS,
          pixelFormat: "rgba",
          audioSampleRate: AUDIO_SAMPLE_RATE,
          audioChannels: AUDIO_CHANNELS,
          displayAspect: DISPLAY_ASPECT,
        },
        options.config,
      );
      const driver = new PokemonGameDriver({
        config: options.config,
        goalGuildIds: options.goalGuildIds,
        driverFeed: feed.service,
        controlPort: 0,
      });
      driver.setBotClient(options.bot);
      const detachMessages = handleMessages(
        options.bot,
        driver,
        options.config,
        async (command) => {
          const runtime = driver.getActiveRuntime();
          if (runtime !== null)
            await enqueueCommand(runtime.emulator, command, runtime.timing);
        },
      );
      const detachInputLog = driver.inputLog.subscribe((records) => {
        const record = records.at(-1);
        if (record !== undefined)
          context.publishEvent({
            id: `${context.session.id}:input:${record.id}`,
            at: record.at,
            kind: "input",
            title: record.user,
            text: record.command,
          });
      });
      const channel = () => ({
        guildId: context.session.guildId,
        voiceChannelId: context.session.voiceChannelId,
      });
      const policy = createPlayPolicy({
        channel,
        voice: botVoicePresence(options.bot),
        players: () =>
          playersInVoice(options.bot, channel(), options.excludedUserIds),
        minimumInChannel: options.config.stream.minimum_in_channel,
      });
      const writes = new Map<string, Promise<void>>();
      const failures: unknown[] = [];
      let latestState: PokemonState | undefined;
      const unsubscribeEvent = driver.onGameEvent((event) => {
        const description = describeGameEvent(event);
        const record = {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          kind: event.kind,
          title: description.title,
          text: description.text,
        };
        context.publishEvent(record);
        const write = (async () => {
          await Promise.resolve();
          try {
            await options.stats.milestone(context.session.guildId, record);
            options.statsChanged(context.session.guildId);
          } catch (error) {
            failures.push(error);
            try {
              context.reportError(
                error instanceof Error ? error : new Error(String(error)),
              );
            } catch (reportError) {
              failures.push(reportError);
            }
          } finally {
            writes.delete(record.id);
          }
        })();
        writes.set(record.id, write);
      });
      const unsubscribeSession = driver.onSessionChange((runtime) => {
        if (runtime === null) return;
        const publish = () => {
          const goal = runtime.goalManager?.getStatus();
          const state = PokemonStateSchema.parse({
            ...readGameStateView(runtime.emulator),
            family: "pokemon",
            goal:
              goal === undefined
                ? null
                : { goal: goal.goal, status: goal.status },
          });
          if (state.phase !== "unavailable") latestState = state;
          context.publishState(state);
        };
        publish();
        runtime.emulator.addFrameHook((frame) => {
          if (frame % 12 === 0) publish();
        });
      });
      return {
        async start(signal) {
          signal.throwIfAborted();
          await driver.onSessionStart(context.session);
        },
        async stop(reason) {
          try {
            let saved = false;
            try {
              await driver.onSessionStop(context.session, reason);
              saved = true;
            } catch (error) {
              failures.push(error);
            }
            await Promise.all(writes.values());
            if (saved && latestState !== undefined) {
              try {
                await options.stats.progress(context.session.guildId, {
                  ...latestState,
                  goal: null,
                });
              } catch (error) {
                failures.push(error);
              }
            }
            options.statsChanged(context.session.guildId);
            if (failures.length > 0)
              throw new AggregateError(
                failures,
                "Pokémon session did not close cleanly",
              );
          } finally {
            detachMessages();
            detachInputLog();
            unsubscribeEvent();
            unsubscribeSession();
            feed.close();
          }
        },
        input() {
          throw new Error("Emerald accepts shared commands");
        },
        clearInput() {
          /* queued commands are bounded; no held controller state */
        },
        async command(player, command) {
          const result = await runInteractiveCommand(
            command,
            { ...player, username: player.name },
            { driver, config: options.config, policy },
          );
          if (!result.accepted) throw new UserError(409, result.reason);
        },
        async goal(objective) {
          const manager = driver.getActiveRuntime()?.goalManager;
          if (manager === undefined)
            throw new UserError(409, "Goals are not enabled for this server");
          const result = await manager.startGoal({
            goal: objective,
            requesterId: context.session.startedByUserId,
            channelId: context.session.textChannelId,
          });
          if (result.kind !== "started")
            throw new UserError(409, result.content);
        },
        screenshot() {
          const runtime = driver.getActiveRuntime();
          if (runtime === null) throw new Error("Pokémon is not running");
          return Promise.resolve(
            encodePng(runtime.emulator.renderFrame(), WIDTH, HEIGHT, 3),
          );
        },
      };
    },
  };
}
