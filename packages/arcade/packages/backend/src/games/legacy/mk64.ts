import type { Client } from "discord.js";
import { games } from "@arcade/common/catalog.ts";
import { toPlayerName } from "@discord-plays-mario-kart/backend/auth/names.ts";
import { RaceStateSchema } from "@arcade/common/telemetry.ts";
import type { GameServerModule } from "#src/games/module.ts";
import type { SelfbotPooledUserbot } from "@shepherdjerred/discord-stream-lifecycle/pool/selfbot-client";
import { MarioKartGameDriver } from "@discord-plays-mario-kart/backend/lifecycle/mario-kart-driver.ts";
import { MK64_SAVE_HISTORY_ENTRIES } from "@discord-plays-mario-kart/backend/engine/index.ts";
import type { Config } from "@discord-plays-mario-kart/backend/config/schema.ts";
import type { SpaghettiBuild } from "@discord-plays-mario-kart/backend/engine/spaghetti/install.ts";
import type { LeaderboardStoreFactory } from "@discord-plays-mario-kart/backend/leaderboard/store.ts";
import { engineFormat } from "@discord-plays-mario-kart/backend/engine/format.ts";
import { EMPTY_BUTTONS } from "@discord-plays-mario-kart/common";
import { encodePng } from "@shepherdjerred/discord-plays-core/image/png.ts";
import type { MediaFeeds } from "#src/media/feeds.ts";
import type { StatsStore } from "#src/stats/store.ts";
import { ResultTracker } from "#src/stats/tracker.ts";
import type { ControllerState } from "@arcade/common/protocol.ts";

export function mk64Module(options: {
  bot: Client;
  config: Config;
  build: SpaghettiBuild | undefined;
  stats: LeaderboardStoreFactory;
  timeTrialStats: StatsStore;
  feeds: MediaFeeds;
  statsChanged: (guildId: string) => void;
}): GameServerModule<SelfbotPooledUserbot> {
  return {
    definition: games.mk64,
    saveEntries: MK64_SAVE_HISTORY_ENTRIES,
    create(context) {
      const format = engineFormat(options.config);
      const feed = options.feeds.create(
        context.session.id,
        {
          ...format,
          pixelFormat: "bgra",
          audioChannels: 2,
          displayAspect: 4 / 3,
        },
        options.config,
      );
      let round = 0;
      let phase = "menu";
      const timeTrials = new ResultTracker({
        gameId: "mk64",
        guildId: context.session.guildId,
        sessionId: context.session.id,
        players: context.players,
        store: options.timeTrialStats,
        recorded: () => {
          options.statsChanged(context.session.guildId);
        },
        failed: context.reportError,
      });
      const driver = new MarioKartGameDriver({
        config: options.config,
        build: options.build,
        stats: options.stats,
        driverFeed: feed.service,
        seatPlayers: () =>
          context.players().map((player) =>
            player === null
              ? null
              : {
                  discordId: player.discordId,
                  name: toPlayerName([player.name], player.discordId),
                },
          ),
        onRaceRecorded: () => {
          options.statsChanged(context.session.guildId);
        },
        onSnapshot(snapshot) {
          if (phase !== "racing" && snapshot.raceState === "racing") round++;
          phase = snapshot.raceState;
          const state = RaceStateSchema.parse({
            family: "racing",
            phase: snapshot.raceState,
            round,
            mode: snapshot.gameMode,
            courseId:
              snapshot.courseId === 20 || snapshot.courseId < 0
                ? null
                : snapshot.courseId,
            engineClass: null,
            mirror: null,
            lapCount: null,
            racers: snapshot.players.flatMap((player, seat) =>
              player.present
                ? [
                    {
                      slot: seat,
                      seat: player.human ? seat : null,
                      human: player.human,
                      characterId: player.characterId,
                      vehicleId: null,
                      lap: null,
                      placement: player.rank === 0 ? null : player.rank,
                      timeMs: player.raceTimeMs,
                      finished: player.finished,
                    },
                  ]
                : [],
            ),
          });
          timeTrials.update(
            state.mode === "time-trials" ? state : { ...state, phase: "menu" },
          );
          context.publishState(state);
        },
      });
      driver.setBotClient(options.bot);
      return {
        async start(signal) {
          signal.throwIfAborted();
          await driver.onSessionStart(context.session);
        },
        async stop(reason) {
          try {
            const failures: unknown[] = [];
            try {
              await driver.onSessionStop(context.session, reason);
            } catch (error) {
              failures.push(error);
            }
            try {
              await timeTrials.flush();
            } catch (error) {
              failures.push(error);
            }
            if (failures.length > 0)
              throw new AggregateError(
                failures,
                "Mario Kart session did not close cleanly",
              );
          } finally {
            feed.close();
          }
        },
        input(seat, state) {
          const buttons = { ...EMPTY_BUTTONS };
          const keys: Readonly<
            Partial<
              Record<
                ControllerState["buttons"][number],
                keyof typeof EMPTY_BUTTONS
              >
            >
          > = {
            a: "a",
            b: "b",
            z: "z",
            l: "l",
            r: "r",
            start: "start",
            up: "up",
            down: "down",
            left: "left",
            right: "right",
            "c-up": "cUp",
            "c-down": "cDown",
            "c-left": "cLeft",
            "c-right": "cRight",
          };
          for (const button of state.buttons) {
            const key = keys[button];
            if (key !== undefined) buttons[key] = true;
          }
          buttons.cUp ||= state.cStickY >= 0.5;
          buttons.cDown ||= state.cStickY <= -0.5;
          buttons.cRight ||= state.cStickX >= 0.5;
          buttons.cLeft ||= state.cStickX <= -0.5;
          driver.getActiveRuntime()?.emulator.setPlayerInput(seat, {
            buttons,
            analogX: state.stickX,
            analogY: state.stickY,
          });
        },
        clearInput(seat) {
          driver.getActiveRuntime()?.emulator.clearPlayerInput(seat);
        },
        playersChanged(players) {
          players.forEach((player, seat) => {
            driver
              .getActiveRuntime()
              ?.nameOverlay?.setName(
                seat,
                player === null
                  ? null
                  : toPlayerName([player.name], player.discordId),
              );
          });
        },
        async screenshot() {
          const runtime = driver.getActiveRuntime();
          if (runtime === null) throw new Error("Mario Kart is not running");
          const frame = await runtime.emulator.renderFrame();
          return encodePng(frame.rgba, frame.width, frame.height, 1);
        },
      };
    },
  };
}
