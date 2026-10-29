import { beforeEach, vi } from "vitest";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

/** The default spy delegates every call to the real counter without a replacement. */
export function traceArchiveReadBudget(label: string) {
  beforeEach((context) => {
    const budgets = new Map<PublicationAuthorityReadBudget, number>();
    const consume = vi.spyOn(
      PublicationAuthorityReadBudget.prototype,
      "consume",
    );
    const report = () => {
      const events = consume.mock.calls.slice(-512).map(([count], index) => {
        const offset = Math.max(0, consume.mock.calls.length - 512);
        const receiver = consume.mock.contexts[offset + index];
        if (!(receiver instanceof PublicationAuthorityReadBudget))
          throw new TypeError("Publication read diagnostic receiver changed");
        let budgetId = budgets.get(receiver);
        if (budgetId === undefined) {
          budgetId = budgets.size + 1;
          budgets.set(receiver, budgetId);
        }
        return { budgetId, count, finalTake: receiver.take };
      });
      console.warn(label, JSON.stringify({ reason: "failed", events }));
    };
    context.onTestFinished(() => {
      try {
        if (context.task.result?.state === "fail") report();
      } finally {
        try {
          consume.mockRestore();
        } finally {
          budgets.clear();
        }
      }
    });
  });
}
