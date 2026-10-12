// Pushes the live game to every open page: the state panel, the event feed,
// recent inputs, and who is playing. Pages get a full snapshot on connect and
// then only changes, so a quiet game costs nothing on the wire.
import type { Client as BotClient } from "discord.js";
import type { Server, Socket } from "socket.io";
import type {
  EventsResponse,
  GameEventEntry,
  GameStateView,
  InputsResponse,
  Player,
  StateResponse,
  Status,
  StatusResponse,
} from "@discord-plays-pokemon/common";
import type { GameEvent } from "#src/game/events/types.ts";
import { describeGameEvent } from "#src/game/events/describe.ts";
import { readGameStateView } from "#src/game/state-view.ts";
import type {
  ActiveSessionRuntime,
  PokemonGameDriver,
} from "#src/lifecycle/pokemon-driver.ts";
import { logger } from "#src/logger.ts";

/** ~0.5 s at the GBA's ~60 fps: often enough to feel live. */
const STATE_POLL_FRAMES = 30;
const EVENT_FEED_CAPACITY = 20;

export type WebPublisherOptions = {
  readonly io: Server;
  readonly driver: Pick<
    PokemonGameDriver,
    "onSessionChange" | "onGameEvent" | "getActiveRuntime" | "inputLog"
  >;
  readonly botClient: BotClient;
  readonly driverFeedEnabled: boolean;
};

export class WebPublisher {
  private readonly io: Server;
  private readonly driver: WebPublisherOptions["driver"];
  private readonly botClient: BotClient;
  private readonly driverFeedEnabled: boolean;
  private state: GameStateView | null = null;
  private stateJson = "null";
  private readonly events: GameEventEntry[] = [];
  private nextEventId = 0;

  constructor(options: WebPublisherOptions) {
    this.io = options.io;
    this.driver = options.driver;
    this.botClient = options.botClient;
    this.driverFeedEnabled = options.driverFeedEnabled;
  }

  start(): void {
    this.driver.onSessionChange((runtime) => {
      this.events.length = 0;
      const events: EventsResponse = { kind: "events", value: [] };
      this.io.emit("response", events);
      this.driver.inputLog.clear();
      if (runtime === null) {
        this.publishState(null);
      } else {
        this.watchSession(runtime);
      }
      this.broadcastStatus();
    });
    this.driver.onGameEvent((event) => {
      this.publishEvent(event);
    });
    this.driver.inputLog.subscribe((entries) => {
      const response: InputsResponse = { kind: "inputs", value: entries };
      this.io.emit("response", response);
    });
    this.botClient.on("voiceStateUpdate", (oldState, newState) => {
      const channelId = this.driver.getActiveRuntime()?.session.voiceChannelId;
      if (channelId === undefined) return;
      if (
        oldState.channelId === channelId ||
        newState.channelId === channelId
      ) {
        this.broadcastStatus();
      }
    });
    this.io.on("connection", (socket: Socket) => {
      this.sendSnapshot(socket);
    });
  }

  /** Everything a freshly opened page needs to render. */
  sendSnapshot(socket: Pick<Socket, "emit">): void {
    const state: StateResponse = { kind: "state", value: this.state };
    const events: EventsResponse = { kind: "events", value: [...this.events] };
    const inputs: InputsResponse = {
      kind: "inputs",
      value: this.driver.inputLog.recent(),
    };
    socket.emit("response", state);
    socket.emit("response", events);
    socket.emit("response", inputs);
    this.sendStatus(socket);
  }

  sendStatus(socket: Pick<Socket, "emit">): void {
    const response: StatusResponse = { kind: "status", value: this.status() };
    socket.emit("response", response);
  }

  private broadcastStatus(): void {
    const response: StatusResponse = { kind: "status", value: this.status() };
    this.io.emit("response", response);
  }

  private status(): Status {
    const runtime = this.driver.getActiveRuntime();
    return {
      sessionActive: runtime !== null,
      driverFeedEnabled: this.driverFeedEnabled,
      playerList: runtime === null ? [] : this.playersIn(runtime),
    };
  }

  private playersIn(runtime: ActiveSessionRuntime): Player[] {
    const { guildId, voiceChannelId } = runtime.session;
    const guild = this.botClient.guilds.cache.get(guildId);
    if (guild === undefined) return [];
    return [...guild.voiceStates.cache.values()]
      .filter(
        (state) =>
          state.channelId === voiceChannelId && state.member?.user.bot !== true,
      )
      .map((state) => ({
        discordId: state.id,
        discordUsername: state.member?.displayName ?? state.id,
      }));
  }

  private watchSession(runtime: ActiveSessionRuntime): void {
    // The emulator belongs to this session and stops with it, taking the hook.
    runtime.emulator.addFrameHook((frame) => {
      if (frame % STATE_POLL_FRAMES !== 0) return;
      if (this.driver.getActiveRuntime() !== runtime) return;
      try {
        const goal = runtime.goalManager?.getStatus();
        this.publishState({
          ...readGameStateView(runtime.emulator),
          goal:
            goal === undefined
              ? null
              : { goal: goal.goal, status: goal.status },
        });
      } catch (error) {
        logger.error("failed to read the game state for the web page", error);
      }
    });
  }

  private publishState(state: GameStateView | null): void {
    const json = JSON.stringify(state);
    if (json === this.stateJson) return;
    this.state = state;
    this.stateJson = json;
    const response: StateResponse = { kind: "state", value: state };
    this.io.emit("response", response);
  }

  private publishEvent(event: GameEvent): void {
    const description = describeGameEvent(event);
    this.nextEventId += 1;
    this.events.push({
      id: String(this.nextEventId),
      at: new Date().toISOString(),
      event: event.kind,
      title: description.title,
      text: description.text,
    });
    if (this.events.length > EVENT_FEED_CAPACITY) this.events.shift();
    const response: EventsResponse = {
      kind: "events",
      value: [...this.events],
    };
    this.io.emit("response", response);
  }
}
