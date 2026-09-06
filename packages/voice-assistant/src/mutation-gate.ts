/** One mutating tool call per wake. Consumers with read-only tools satisfy it trivially. */
export class VoiceMutationGate {
  private mutated = false;

  claim(): boolean {
    if (this.mutated) return false;
    this.mutated = true;
    return true;
  }

  /**
   * Undo a claim whose operation failed at the input boundary, before any mutation — a boundary
   * failure throws pre-dispatch, so the model may retry with corrected arguments instead of
   * burning the whole wake on one bad guess. Never released for unknown errors: those may have
   * landed after a dispatch, and a burned wake is safer than two mutations.
   */
  release(): void {
    this.mutated = false;
  }

  get hasMutated(): boolean {
    return this.mutated;
  }
}
