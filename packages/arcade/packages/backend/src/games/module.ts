import type { ControllerState } from "@arcade/common/protocol.ts";
import type { GameDefinition, Player } from "@arcade/common/catalog.ts";
import type { GameEvent, GameState } from "@arcade/common/telemetry.ts";
import type { PooledUserbot } from "@shepherdjerred/discord-stream-lifecycle/pool/pooled-userbot";
import type {
  Session,
  SessionStopReason,
} from "@shepherdjerred/discord-stream-lifecycle/session/session";

export type ArcadeSession<T extends PooledUserbot> = Session<T> & {
  readonly id: string;
  readonly game: GameDefinition;
};

export type GameSession = {
  start: (signal: AbortSignal) => Promise<void>;
  stop: (reason: SessionStopReason) => Promise<void>;
  input: (seat: number, state: ControllerState) => void;
  clearInput: (seat: number) => void;
  playersChanged?: (players: readonly (Player | null)[]) => void;
  command?: (user: Player, command: string) => Promise<void>;
  goal?: (objective: string) => Promise<void>;
  screenshot: () => Promise<Buffer>;
};

export type GameServerModule<T extends PooledUserbot> = {
  readonly definition: GameDefinition;
  create: (context: {
    session: ArcadeSession<T>;
    players: () => readonly (Player | null)[];
    publishState: (state: GameState) => void;
    publishEvent: (event: GameEvent) => void;
    reportError: (error: Error) => void;
    fatalError: (error: Error) => void;
  }) => GameSession;
};
