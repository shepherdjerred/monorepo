import {
  deleteState,
  stateFilePath,
} from "@shepherdjerred/streambot/state/persistence.ts";
import type { Session } from "@shepherdjerred/streambot/session/session-types.ts";

/**
 * Drain any in-flight checkpoint, then delete the session's resume-state file. A checkpoint that
 * started before teardown could otherwise complete its write AFTER the delete, re-creating a stale
 * file that would wrongly resume the just-finished item on the next boot. `session.torndown` blocks
 * writes still queued on the tail; awaiting the tail drains the one that may already be mid-write.
 */
export async function deleteSessionStateAfterFlush(
  stateDir: string,
  session: Session,
): Promise<void> {
  try {
    await session.snapshotTail;
  } catch {
    // The checkpoint path already logged its own write failure; deletion remains authoritative.
  }
  await deleteState(
    stateFilePath(stateDir, session.guildId, session.voiceChannelId),
  );
}
