// A local fixture server for rendering every game panel without Discord or ROMs.
// Run from this package: bun test/support/ui-fixture.ts
import express from "express";
import { createServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { z } from "zod";
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
const Scenario = z.strictObject({
  phase: z.enum(["playing", "idle", "results", "error"]),
  signedIn: z.boolean(),
  controls: z.boolean(),
});
let scenario: z.infer<typeof Scenario> = {
  phase: "playing",
  signedIn: true,
  controls: process.argv.includes("--controls"),
};
let seatClaimed = true;
const subscriptions = new Map<Socket, GameId>();
const requests: RoomRequest[] = [];
app.use(express.json());
app.post("/fixture/scenario", (request, response) => {
  scenario = Scenario.parse(request.body);
  seatClaimed = true;
  requests.length = 0;
  for (const [socket, gameId] of subscriptions) publish(socket, gameId);
  response.json(scenario);
});
app.get("/fixture/inputs", (_request, response) => {
  response.json(requests);
});
app.get("/api/me", (_request, response) => {
  response.json(
    scenario.signedIn
      ? { signedIn: true, user: { ...players[0], username: "alex" } }
      : { signedIn: false },
  );
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
app.post("/api/sessions", (request, response) => {
  z.strictObject({ guildId: z.literal("123"), gameId: GameIdSchema }).parse(
    request.body,
  );
  scenario = { ...scenario, phase: "playing" };
  for (const [socket, gameId] of subscriptions) publish(socket, gameId);
  response.status(201).json({});
});
app.delete("/api/sessions/:id", (_request, response) => {
  scenario = { ...scenario, phase: "idle" };
  for (const [socket, gameId] of subscriptions) publish(socket, gameId);
  response.json({});
});
app.post("/api/sessions/:id/goal", (request, response) => {
  z.strictObject({ objective: z.string().min(1).max(1000) }).parse(
    request.body,
  );
  response.json({});
});
io.on("connection", (socket) => {
  socket.on("disconnect", () => {
    subscriptions.delete(socket);
  });
  socket.on("request", (message: unknown) => {
    const request = RoomRequestSchema.parse(message);
    if (scenario.controls && request.kind !== "subscribe") {
      requests.push(request);
      if (requests.length > 20) requests.shift();
      if (request.kind === "release" || request.kind === "claim") {
        seatClaimed = request.kind === "claim";
        const gameId = subscriptions.get(socket);
        if (gameId !== undefined) publish(socket, gameId);
      }
    }
    if (request.kind !== "subscribe") return;
    const gameId = request.gameId;
    subscriptions.set(socket, gameId);
    publish(socket, gameId);
  });
});

function publish(socket: Socket, gameId: GameId) {
  const state = gameState(gameId);
  const result =
    scenario.phase !== "results" || state.family === "pokemon"
      ? state
      : state.family === "racing"
        ? {
            ...state,
            phase: "finished",
            racers: state.racers.map((racer) => ({ ...racer, finished: true })),
          }
        : {
            ...state,
            phase: "results",
            remainingMs: 0,
            fighters: state.fighters.map((fighter, index) => ({
              ...fighter,
              placement: index + 1,
              winner: index === 0,
            })),
          };
  socket.emit(
    "room",
    RoomSnapshotSchema.parse({
      guildId: "123",
      gameId,
      session:
        scenario.phase === "idle"
          ? null
          : {
              id: "f5231377-25ea-4a82-91f2-17a379ef5655",
              guildId: "123",
              gameId,
              voiceChannelId: "456",
              startedByUserId: "10",
              startedAt: at,
              phase: scenario.phase === "error" ? "failed" : "running",
            },
      state: scenario.phase === "idle" ? null : result,
      seats:
        gameId === "emerald"
          ? []
          : players.map((player, index) =>
              index === 0 && !seatClaimed && scenario.controls ? null : player,
            ),
      participants: players,
      events: [event],
      error:
        scenario.phase === "error"
          ? "The game stopped after a runtime error. Your previous save is safe."
          : null,
    }),
  );
  socket.emit("access", {
    sessionId: "f5231377-25ea-4a82-91f2-17a379ef5655",
    seat:
      gameId !== "emerald" &&
      seatClaimed &&
      scenario.phase !== "idle" &&
      scenario.controls &&
      scenario.signedIn
        ? 0
        : null,
    canPlay:
      scenario.controls && scenario.signedIn && scenario.phase === "playing",
    canWatch: false,
    canStop: scenario.controls && scenario.signedIn,
    reason: "UI fixture — controls and game feeds are disconnected.",
  });
}
server.listen(8081, "127.0.0.1", () => {
  process.stdout.write(
    `Arcade UI fixtures: ${Object.keys(games).join(", ")}\n`,
  );
});
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    void io.close();
  });
