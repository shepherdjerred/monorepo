// A local fixture server for rendering every game panel without Discord or ROMs.
// Run from this package: bun test/support/ui-fixture.ts
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { games, GameIdSchema, type GameId } from "@arcade/common/catalog.ts";
import {
  RoomRequestSchema,
  RoomSnapshotSchema,
  type RoomRequest,
} from "@arcade/common/protocol.ts";
import { GameStateSchema } from "@arcade/common/telemetry.ts";
import { StatsSchema } from "@arcade/common/stats.ts";

const players = ["Alex", "Jamie", "Sam", "Taylor"].map((name, index) => ({
  discordId: String(index + 10),
  name,
  avatarUrl: null,
}));
const at = "2026-10-13T20:00:00.000Z";
const event = {
  id: "fixture-round",
  at,
  kind: "round",
  title: "Next round",
  text: "Everyone is ready for another game.",
};
function gameState(gameId: GameId) {
  if (gameId === "emerald")
    return GameStateSchema.parse({
      family: "pokemon",
      phase: "overworld",
      location: "Petalburg Woods",
      party: [
        {
          species: "Treecko",
          nickname: "Basil",
          level: 18,
          hp: 42,
          maxHp: 46,
          isEgg: false,
        },
        {
          species: "Ralts",
          nickname: "Echo",
          level: 14,
          hp: 26,
          maxHp: 31,
          isEgg: false,
        },
        {
          species: "Taillow",
          nickname: "Pip",
          level: 16,
          hp: 34,
          maxHp: 34,
          isEgg: false,
        },
      ],
      badges: [true, true, false, false, false, false, false, false],
      pokedexOwned: 14,
      money: 3200,
      goal: { goal: "Find our next badge", status: "running" },
    });
  if (gameId === "mk64" || gameId === "mkwii")
    return GameStateSchema.parse({
      family: "racing",
      phase: "racing",
      round: 3,
      mode: "versus",
      courseId: gameId === "mk64" ? 8 : 8,
      engineClass: "100cc",
      mirror: false,
      lapCount: 3,
      racers: players.map((_player, seat) => ({
        slot: seat,
        seat,
        human: true,
        characterId: seat,
        vehicleId: gameId === "mkwii" ? seat : null,
        lap: 2,
        placement: seat + 1,
        timeMs: 81_200 + seat * 1700,
        finished: false,
      })),
    });
  const characters = gameId === "melee" ? [8, 6, 2, 1] : [0, 2, 7, 28];
  return GameStateSchema.parse({
    family: "fighting",
    phase: "playing",
    round: 4,
    mode: "stock",
    teams: false,
    stageId: gameId === "melee" ? 32 : 1,
    remainingMs: 184_000,
    fighters: players.map((_player, seat) => ({
      seat,
      human: true,
      characterId: characters[seat],
      damage: [18, 76, 122, 44][seat],
      stocks: [3, 2, 1, 3][seat],
      score: null,
      kos: seat,
      falls: 3 - seat,
      selfDestructs: 0,
      placement: null,
      winner: null,
    })),
  });
}
function stats(gameId: GameId) {
  const state = gameState(gameId);
  const racing = state.family === "racing";
  return StatsSchema.parse({
    guildId: "123",
    gameId,
    totalRounds: 12,
    leaderboard:
      gameId === "emerald"
        ? []
        : players.map((player, index) => ({
            player,
            played: 12,
            wins: 6 - index,
            winRate: (6 - index) / 12,
            podiums: racing ? 10 - index : null,
            averagePlacement: racing ? 1.5 + index / 2 : null,
            kos: racing ? null : 24 - index * 3,
            falls: racing ? null : 12 + index,
            selfDestructs: racing ? null : index,
            characters: [
              {
                characterId:
                  state.family === "fighting"
                    ? state.fighters[index]?.characterId
                    : index,
                played: 12,
                wins: 6 - index,
              },
            ],
            placements: [6 - index, 4, 2, index],
          })),
    records: [],
    recent: [],
    milestones: [event],
    progress: state.family === "pokemon" ? state : null,
  });
}
const app = express();
const controls = process.argv.includes("--controls");
const requests: RoomRequest[] = [];
app.get("/fixture/inputs", (_request, response) => {
  response.json(requests);
});
app.get("/api/me", (_request, response) => {
  response.json({ signedIn: true, user: { ...players[0], username: "alex" } });
});
app.get("/api/servers", (_request, response) => {
  response.json([
    { id: "123", name: "Arcade fixture", voiceChannelName: "Game night" },
  ]);
});
app.get("/api/stats", (request, response) => {
  response.json(stats(GameIdSchema.parse(request.query["gameId"])));
});
const server = createServer(app);
const io = new Server(server);
io.on("connection", (socket) => {
  socket.on("request", (message: unknown) => {
    const request = RoomRequestSchema.parse(message);
    if (controls && request.kind !== "subscribe") {
      requests.push(request);
      if (requests.length > 20) requests.shift();
    }
    if (request.kind !== "subscribe") return;
    const gameId = request.gameId;
    socket.emit(
      "room",
      RoomSnapshotSchema.parse({
        guildId: "123",
        gameId,
        session: {
          id: "f5231377-25ea-4a82-91f2-17a379ef5655",
          guildId: "123",
          gameId,
          voiceChannelId: "456",
          startedByUserId: "10",
          startedAt: at,
          phase: "running",
        },
        state: gameState(gameId),
        seats: gameId === "emerald" ? [] : players,
        participants: players,
        events: [event],
        error: null,
      }),
    );
    socket.emit("access", {
      sessionId: "f5231377-25ea-4a82-91f2-17a379ef5655",
      seat: controls && gameId !== "emerald" ? 0 : null,
      canPlay: controls,
      canWatch: false,
      canStop: false,
      reason: "UI fixture — controls and game feeds are disconnected.",
    });
  });
});
server.listen(8081, "127.0.0.1", () => {
  process.stdout.write(
    `Arcade UI fixtures: ${Object.keys(games).join(", ")}\n`,
  );
});
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    void io.close();
  });
