import type { ActorRef, FeedbackScope } from "#shared/contract.ts";

export type Waiter = {
  id: string;
  actor: ActorRef;
  scope: FeedbackScope;
  since: Date;
};

/**
 * Actors holding an open feedback stream, in this process. One replica serves
 * the service, so this is the whole set; the UI shows who is waiting.
 */
export function createWaiters() {
  const waiters = new Map<string, Waiter>();
  return {
    add(actor: ActorRef, scope: FeedbackScope, now: Date): () => void {
      const id = crypto.randomUUID();
      waiters.set(id, { id, actor, scope, since: now });
      return () => {
        waiters.delete(id);
      };
    },
    all: (): Waiter[] => [...waiters.values()],
    count: () => waiters.size,
  };
}
export type Waiters = ReturnType<typeof createWaiters>;
