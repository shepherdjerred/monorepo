import { Client } from "discord.js";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { expect, test, vi } from "vitest";
import type { Response } from "@discord-plays-pokemon/common";
import { InputLog } from "#src/game/input-log.ts";
import type { GameEvent } from "#src/game/events/types.ts";
import type { ActiveSessionRuntime } from "#src/lifecycle/pokemon-driver.ts";
import { WebPublisher } from "./web-publisher.ts";

test("a session boundary clears and broadcasts history before a new viewer's snapshot", async () => {
  let changeSession:
    ((runtime: ActiveSessionRuntime | null) => void) | undefined;
  let gameEvent: ((event: GameEvent) => void) | undefined;
  const inputLog = new InputLog(10);
  const http = createServer();
  const io = new Server(http);
  await new Promise<void>((resolve) => {
    http.listen(0, "127.0.0.1", resolve);
  });
  const broadcasts: Response[] = [];
  const emit = vi
    .spyOn(io, "emit")
    .mockImplementation((_name, response: Response) => {
      broadcasts.push(response);
      return true;
    });
  const bot = new Client({ intents: [] });
  const publisher = new WebPublisher({
    io,
    botClient: bot,
    driverFeedEnabled: false,
    identify: () => Promise.resolve(undefined),
    policy: {
      players: () => [],
      voiceChannelName: () => null,
      blockerFor: () => "no-session",
      canWatch: () => false,
      minimumInChannel: 2,
    },
    driver: {
      getActiveRuntime: () => null,
      inputLog,
      onSessionChange: (listener) => {
        changeSession = listener;
        return () => {
          changeSession = undefined;
        };
      },
      onGameEvent: (listener) => {
        gameEvent = listener;
        return () => {
          gameEvent = undefined;
        };
      },
    },
  });
  try {
    publisher.start();
    if (changeSession === undefined || gameEvent === undefined)
      throw new Error("publisher listeners missing");
    gameEvent({ kind: "whiteout" });
    gameEvent({ kind: "catch", species: 277, shiny: true });
    gameEvent({
      kind: "evolution",
      fromSpecies: 277,
      toSpecies: 278,
      nickname: "MUDDY",
      level: 16,
    });
    inputLog.record({
      user: "Previous guild's trainer",
      source: "discord",
      command: "up",
    });
    const before: Response[] = [];
    publisher.sendSnapshot(
      {
        emit: (_name: string, response: Response) => {
          before.push(response);
          return true;
        },
      },
      undefined,
    );
    expect(before).toContainEqual(
      expect.objectContaining({
        kind: "events",
        value: [
          expect.objectContaining({
            event: "whiteout",
            pokemonArtwork: [],
          }),
          expect.objectContaining({
            event: "catch",
            pokemonArtwork: [{ nationalDexNumber: 252, shiny: true }],
          }),
          expect.objectContaining({
            event: "evolution",
            pokemonArtwork: [
              { nationalDexNumber: 252, shiny: false },
              { nationalDexNumber: 253, shiny: false },
            ],
          }),
        ],
      }),
    );

    broadcasts.length = 0;
    changeSession(null);
    expect(broadcasts).toContainEqual({ kind: "events", value: [] });
    expect(broadcasts).toContainEqual({ kind: "inputs", value: [] });
    const after: Response[] = [];
    publisher.sendSnapshot(
      {
        emit: (_name: string, response: Response) => {
          after.push(response);
          return true;
        },
      },
      undefined,
    );
    expect(after).toContainEqual({ kind: "events", value: [] });
    expect(after).toContainEqual({ kind: "inputs", value: [] });
    expect(inputLog.recent()).toEqual([]);
  } finally {
    emit.mockRestore();
    await io.close();
    await bot.destroy();
  }
});
