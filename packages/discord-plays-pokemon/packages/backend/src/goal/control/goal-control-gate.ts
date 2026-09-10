export class GoalControlGate {
  private acceptingGoalId: string | undefined;
  private inFlight = 0;
  private readonly drainWaiters = new Set<() => void>();

  open(goalId: string): void {
    if (this.acceptingGoalId !== undefined) {
      throw new Error(
        `goal control gate is already open for ${this.acceptingGoalId}`,
      );
    }
    this.acceptingGoalId = goalId;
  }

  close(goalId: string): void {
    if (this.acceptingGoalId === goalId) {
      this.acceptingGoalId = undefined;
    }
  }

  begin(goalId: string): (() => void) | undefined {
    if (this.acceptingGoalId !== goalId) return undefined;
    this.inFlight += 1;
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      this.inFlight -= 1;
      if (this.inFlight !== 0) return;
      for (const resolve of this.drainWaiters) resolve();
      this.drainWaiters.clear();
    };
  }

  async drain(): Promise<void> {
    if (this.inFlight === 0) return;
    await new Promise<void>((resolve) => {
      this.drainWaiters.add(resolve);
    });
  }
}
