/**
 * Per-conversation serialization lock for VoltAgent streamText calls.
 *
 * Background: every Discord channel maps to one VoltAgent conversationId.
 * If the user fires multiple `@Baron` pings in quick succession, each
 * message-create handler starts its own `agent.streamText()` immediately,
 * and they all write to the same libSQL conversation memory concurrently.
 * Two failure modes follow:
 *
 *   1. GPT-5 reasoning replay (`store: false` + `reasoning.encrypted_content`)
 *      requires each turn's encrypted reasoning blob to be reattached to the
 *      next turn's input. Concurrent turns interleave their memory writes,
 *      so the encrypted content seen by turn N+1 may belong to a peer turn
 *      that hasn't finished yet — the model errors mid-stream and a
 *      sub-agent reaches `bail()` with no output. That's the silent-typing-
 *      cursor bug observed in production.
 *
 *   2. The supervisor's `delegate_task` machinery shares per-operation
 *      state across the agent tree. Overlapping operations on the same
 *      conversation can poison span context, abort siblings, or trip
 *      VoltAgent's own concurrency assertions.
 *
 * This lock chains all turns for a given conversationId into a single
 * sequential queue. The first turn runs immediately; subsequent turns
 * await their predecessor before proceeding. A failed prior turn does
 * NOT block subsequent ones — we swallow its rejection inside the chain
 * so a single error can't break the whole channel.
 *
 * Memory: the map entry is removed once the latest queued turn settles
 * and no newer turn has chained on, so idle channels leave no residue.
 */

const locks = new Map<string, Promise<unknown>>();

export async function withConversationLock<T>(
  conversationId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = locks.get(conversationId);
  const promise = (async () => {
    if (previous != undefined) {
      try {
        await previous;
      } catch {
        // Intentional: a prior turn's failure must not block subsequent
        // turns on the same conversation. The prior turn already reported
        // its own error to its caller; we just need its `await` to settle.
      }
    }
    return await fn();
  })();
  locks.set(conversationId, promise);
  try {
    return await promise;
  } finally {
    if (locks.get(conversationId) === promise) {
      locks.delete(conversationId);
    }
  }
}
