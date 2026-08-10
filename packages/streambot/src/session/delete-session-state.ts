import {
  deleteState,
  stateFilePath,
} from "@shepherdjerred/streambot/state/persistence.ts";
import type { Session } from "@shepherdjerred/streambot/session/session-types.ts";

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
