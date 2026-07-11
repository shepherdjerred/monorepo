// Tracks which socket owns each of the (up to 4) controller seats, plus the
// display name set for that seat. Input state itself is latched in the
// emulator; this only governs claim/release/ownership and naming.
type Seat = { socketId: string; name: string | null };

export class SeatManager {
  private readonly seats: (Seat | null)[];

  constructor(private readonly count: number) {
    this.seats = Array.from({ length: count }, () => null);
  }

  /** Claim a seat for a socket (specific or lowest-free). Returns the seat, the
   *  socket's existing seat, or null if none available. */
  claim(socketId: string, requested?: number): number | null {
    const existing = this.seatOf(socketId);
    if (existing !== null) return existing;
    if (requested !== undefined) {
      if (
        requested >= 0 &&
        requested < this.count &&
        this.seats[requested] === null
      ) {
        this.seats[requested] = { socketId, name: null };
        return requested;
      }
      return null;
    }
    for (let i = 0; i < this.count; i++) {
      if (this.seats[i] === null) {
        this.seats[i] = { socketId, name: null };
        return i;
      }
    }
    return null;
  }

  /** Release a socket's seat. Returns the freed seat, or null if it had none. */
  release(socketId: string): number | null {
    const seat = this.seatOf(socketId);
    if (seat !== null) this.seats[seat] = null;
    return seat;
  }

  /** Set (or clear) the display name on the caller's seat. Returns the seat or
   *  null if the socket holds no seat. */
  setName(socketId: string, name: string | null): number | null {
    const seat = this.seatOf(socketId);
    if (seat === null) return null;
    const current = this.seats[seat];
    if (current != null) current.name = name;
    return seat;
  }

  seatOf(socketId: string): number | null {
    const i = this.seats.findIndex((s) => s?.socketId === socketId);
    return i === -1 ? null : i;
  }

  owns(socketId: string, seat: number): boolean {
    return (
      seat >= 0 && seat < this.count && this.seats[seat]?.socketId === socketId
    );
  }

  /** Per-seat occupancy for broadcasting to clients. */
  occupied(): boolean[] {
    return this.seats.map((s) => s !== null);
  }

  /** Per-seat display names (index-aligned with occupied()); null if unnamed. */
  names(): (string | null)[] {
    return this.seats.map((s) => s?.name ?? null);
  }
}
