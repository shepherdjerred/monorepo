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
import type { DiscordUser } from "@shepherdjerred/discord-plays-core/auth/protocol.ts";
import type { PlayPolicy } from "./play-policy.ts";

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
  readonly policy: PlayPolicy;
  readonly identify: (socket: Socket) => Promise<DiscordUser | undefined>;
};

export class WebPublisher {
  private readonly io: Server;
  private readonly driver: WebPublisherOptions["driver"];
  private readonly botClient: BotClient;
  private readonly driverFeedEnabled: boolean;
  private readonly policy: PlayPolicy;
  private readonly identify: WebPublisherOptions["identify"];
  private state: GameStateView | null = null;
  private stateJson = "null";
  private readonly events: GameEventEntry[] = [];
  private nextEventId = 0;

  constructor(options: WebPublisherOptions) {
    this.io = options.io;
    this.driver = options.driver;
    this.botClient = options.botClient;
    this.driverFeedEnabled = options.driverFeedEnabled;
    this.policy = options.policy;
    this.identify = options.identify;
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
      void this.identifyAndSend(socket, true);
    });
  }

  /** Everything a freshly opened page needs to render. */
  sendSnapshot(
    socket: Pick<Socket, "emit">,
    user: DiscordUser | undefined,
  ): void {
    const state: StateResponse = { kind: "state", value: this.state };
    const events: EventsResponse = { kind: "events", value: [...this.events] };
    const inputs: InputsResponse = {
      kind: "inputs",
      value: this.driver.inputLog.recent(),
    };
    socket.emit("response", state);
    socket.emit("response", events);
    socket.emit("response", inputs);
    this.sendStatus(socket, user);
  }

  sendStatus(
    socket: Pick<Socket, "emit">,
    user: DiscordUser | undefined,
  ): void {
    const response: StatusResponse = {
      kind: "status",
      value: this.status(user),
    };
    socket.emit("response", response);
  }

  private broadcastStatus(): void {
    for (const socket of this.io.sockets.sockets.values()) {
      void this.identifyAndSend(socket, false);
    }
  }

  private async identifyAndSend(
    socket: Socket,
    snapshot: boolean,
  ): Promise<void> {
    try {
      const user = await this.identify(socket);
      if (!socket.connected) return;
      if (snapshot) this.sendSnapshot(socket, user);
      else this.sendStatus(socket, user);
    } catch (error) {
      logger.error("web session lookup failed", error);
    }
  }

  private status(user: DiscordUser | undefined): Status {
    const runtime = this.driver.getActiveRuntime();
    return {
      sessionActive: runtime !== null,
      driverFeedEnabled: this.driverFeedEnabled,
      playerList: this.policy.players(),
      playBlocker: this.policy.blockerFor(user),
      voiceChannelName: this.policy.voiceChannelName(),
      minimumInChannel: this.policy.minimumInChannel,
    };
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
