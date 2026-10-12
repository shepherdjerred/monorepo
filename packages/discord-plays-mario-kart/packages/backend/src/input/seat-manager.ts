// Which signed-in Discord user drives each of the (up to 4) controller seats,
// and from which browser connection. Input state itself is latched in the
// engine; this only governs claim/release/ownership.
//
// A Discord account holds at most one seat. Claiming from a second tab moves
// the seat to that tab, so a player who reopens the page is not locked out by
// their own stale connection.
import type { DiscordUser } from "@shepherdjerred/discord-plays-core/auth/protocol.ts";

type Seat = { socketId: string; user: DiscordUser };

export type ClaimResult =
  | {
      kind: "claimed";
      seat: number;
      /** The same user's other connection that held a seat until now. */
      displacedSocketId: string | undefined;
      /** The seat that connection held, when it differs from `seat`. */
      vacatedSeat: number | undefined;
    }
  | { kind: "taken" };

export class SeatManager {
  private readonly seats: (Seat | null)[];

  constructor(private readonly count: number) {
    this.seats = Array.from({ length: count }, () => null);
  }

  /**
   * Claim a seat (specific or lowest free) for a user on a connection. A
   * connection that already holds a seat keeps it.
   */
  claim(socketId: string, user: DiscordUser, requested?: number): ClaimResult {
    const existing = this.seatOf(socketId);
    if (existing !== null) {
      return {
        kind: "claimed",
        seat: existing,
        displacedSocketId: undefined,
        vacatedSeat: undefined,
      };
    }
    const held = this.seatOfUser(user.discordId);
    const heldSeat = held === null ? undefined : this.seats[held];
    const target = this.pickSeat(requested, held);
    if (target === undefined) return { kind: "taken" };

    if (held !== null) this.seats[held] = null;
    this.seats[target] = { socketId, user };
    return {
      kind: "claimed",
      seat: target,
      displacedSocketId: heldSeat?.socketId,
      vacatedSeat: held !== null && held !== target ? held : undefined,
    };
  }

  /** Release a connection's seat. Returns the freed seat, or null if it had none. */
  release(socketId: string): number | null {
    const seat = this.seatOf(socketId);
    if (seat !== null) this.seats[seat] = null;
    return seat;
  }

  /** Release whatever seat a user holds (they left the voice channel). */
  releaseUser(discordId: string): { seat: number; socketId: string } | null {
    const seat = this.seatOfUser(discordId);
    if (seat === null) return null;
    const holder = this.seats[seat];
    this.seats[seat] = null;
    return holder == null ? null : { seat, socketId: holder.socketId };
  }

  /** Refresh a seated user's name and avatar (e.g. their nickname changed). */
  updateUser(user: DiscordUser): number | null {
    const seat = this.seatOfUser(user.discordId);
    if (seat === null) return null;
    const holder = this.seats[seat];
    if (holder != null) holder.user = user;
    return seat;
  }

  seatOf(socketId: string): number | null {
    const i = this.seats.findIndex((s) => s?.socketId === socketId);
    return i === -1 ? null : i;
  }

  seatOfUser(discordId: string): number | null {
    const i = this.seats.findIndex((s) => s?.user.discordId === discordId);
    return i === -1 ? null : i;
  }

  owns(socketId: string, seat: number): boolean {
    return (
      seat >= 0 && seat < this.count && this.seats[seat]?.socketId === socketId
    );
  }

  /** Who holds each seat (index = seat), for broadcasting to clients. */
  users(): (DiscordUser | null)[] {
    return this.seats.map((s) => s?.user ?? null);
  }

  /** Every seated user's Discord id, for the voice-channel sweep. */
  seatedUserIds(): string[] {
    return this.seats.flatMap((s) => (s === null ? [] : [s.user.discordId]));
  }

  /** `requested` if free (or already this user's), else the lowest free seat when unrequested. */
  private pickSeat(
    requested: number | undefined,
    held: number | null,
  ): number | undefined {
    const usable = (i: number) => this.seats[i] === null || i === held;
    if (requested !== undefined) {
      return requested >= 0 && requested < this.count && usable(requested)
        ? requested
        : undefined;
    }
    if (held !== null) return held;
    for (let i = 0; i < this.count; i++) if (usable(i)) return i;
    return undefined;
  }
}
