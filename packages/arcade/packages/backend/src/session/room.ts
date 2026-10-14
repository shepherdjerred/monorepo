import type { ControllerState, RoomSnapshot } from "@arcade/common/protocol.ts";
import type {
  GameDefinition,
  Player,
  SessionView,
} from "@arcade/common/catalog.ts";
import type { GameEvent, GameState } from "@arcade/common/telemetry.ts";
import type { GameSession } from "#src/games/module.ts";

type Seat = { connectionId: string; player: Player };

export class Room {
  private session: SessionView | null = null;
  private state: GameState | null = null;
  private error: string | null = null;
  private events: GameEvent[] = [];
  private readonly seats: (Seat | null)[];
  private controls: GameSession | undefined;

  constructor(
    readonly guildId: string,
    readonly game: GameDefinition,
    private readonly changed: () => void,
  ) {
    this.seats = Array.from({ length: game.seats }, () => null);
  }

  snapshot(): RoomSnapshot {
    return {
      guildId: this.guildId,
      gameId: this.game.id,
      session: this.session,
      state: this.state,
      seats: [...this.players()],
      events: [...this.events],
      participants: [],
      error: this.error,
    };
  }

  players(): readonly (Player | null)[] {
    return this.seats.map((seat) => seat?.player ?? null);
  }

  setSession(session: SessionView): void {
    if (this.session?.id !== session.id) {
      this.state = null;
      this.events = [];
      this.error = null;
    }
    this.session = session;
    this.changed();
  }

  setControls(sessionId: string, controls: GameSession): void {
    if (this.session?.id !== sessionId)
      throw new Error("controls belong to another session");
    this.controls = controls;
  }

  claim(
    sessionId: string,
    connectionId: string,
    player: Player,
    seat: number,
  ): "claimed" | "taken" | "not-active" {
    if (
      !this.running(sessionId) ||
      !Number.isInteger(seat) ||
      seat < 0 ||
      seat >= this.seats.length
    )
      return "not-active";
    const current = this.seats[seat];
    if (
      current !== null &&
      current !== undefined &&
      current.player.discordId !== player.discordId
    )
      return "taken";
    this.releaseUser(player.discordId);
    this.seats[seat] = { connectionId, player };
    this.controls?.playersChanged?.(this.players());
    this.changed();
    return "claimed";
  }

  release(connectionId: string): void {
    this.seats.forEach((seat, index) => {
      if (seat?.connectionId !== connectionId) return;
      this.controls?.clearInput(index);
      this.seats[index] = null;
      this.controls?.playersChanged?.(this.players());
      this.changed();
    });
  }

  releaseUser(userId: string): void {
    for (const seat of this.seats)
      if (seat?.player.discordId === userId) this.release(seat.connectionId);
  }

  owns(sessionId: string, connectionId: string): boolean {
    return (
      this.running(sessionId) &&
      this.seats.some((seat) => seat?.connectionId === connectionId)
    );
  }

  seatOf(sessionId: string, connectionId: string): number | null {
    if (!this.running(sessionId)) return null;
    const seat = this.seats.findIndex(
      (entry) => entry?.connectionId === connectionId,
    );
    return seat === -1 ? null : seat;
  }

  input(
    sessionId: string,
    connectionId: string,
    state: ControllerState,
  ): boolean {
    if (!this.running(sessionId)) return false;
    const seat = this.seats.findIndex(
      (entry) => entry?.connectionId === connectionId,
    );
    if (seat === -1) return false;
    this.controls?.input(seat, state);
    return true;
  }

  clearAllInput(): void {
    const failures: unknown[] = [];
    this.seats.forEach((_seat, index) => {
      try {
        this.controls?.clearInput(index);
      } catch (error) {
        failures.push(error);
      }
    });
    if (failures.length > 0)
      throw new AggregateError(failures, "Failed to clear game controllers");
  }

  publishState(sessionId: string, state: GameState): void {
    if (this.session?.id !== sessionId) return;
    if (state.family !== this.game.family)
      throw new Error("game telemetry family mismatch");
    this.state = state;
    this.changed();
  }

  publishEvent(sessionId: string, event: GameEvent): void {
    if (this.session?.id !== sessionId) return;
    this.events = [
      ...this.events.filter((entry) => entry.id !== event.id),
      event,
    ].slice(-30);
    this.changed();
  }

  reportError(sessionId: string, error: Error): void {
    if (this.session?.id !== sessionId) return;
    this.error = error.message;
    this.changed();
  }

  end(sessionId: string): void {
    if (this.session?.id !== sessionId) return;
    try {
      this.clearAllInput();
    } finally {
      this.seats.fill(null);
      this.controls = undefined;
      this.session = null;
      this.state = null;
      this.changed();
    }
  }

  private running(sessionId: string): boolean {
    return this.session?.id === sessionId && this.session.phase === "running";
  }
}
