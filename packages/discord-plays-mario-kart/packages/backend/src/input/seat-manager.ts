// Tracks which socket owns each of the (up to 4) controller seats. Input state
// itself is latched in the emulator; this only governs claim/release/ownership.
export class SeatManager {
  private readonly seats: (string | null)[];

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
        this.seats[requested] = socketId;
        return requested;
      }
      return null;
    }
    for (let i = 0; i < this.count; i++) {
      if (this.seats[i] === null) {
        this.seats[i] = socketId;
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

  seatOf(socketId: string): number | null {
    const i = this.seats.indexOf(socketId);
    return i === -1 ? null : i;
  }

  owns(socketId: string, seat: number): boolean {
    return seat >= 0 && seat < this.count && this.seats[seat] === socketId;
  }

  /** Per-seat occupancy for broadcasting to clients. */
  occupied(): boolean[] {
    return this.seats.map((s) => s !== null);
  }
}
