import type { Session } from "@shepherdjerred/streambot/session/session-types.ts";

export async function destroySession(
  session: Session,
  saveSnapshot: (session: Session) => Promise<void>,
): Promise<void> {
  session.entry.userbot.setVoiceCloseListener(null);
  session.entry.userbot.setStallListener(null);
  session.voiceAssistant?.close();
  // close() aborts the in-flight turn, but its catch/finally (announce, hold release) settle
  // asynchronously. Wait for the hold so that cleanup runs before the actor stops and the
  // process exits, instead of racing a stopped session.
  await session.teardownHold.drain();
  session.entry.userbot.setVoiceAudioListener(null);
  if (session.checkpointTimer !== null) {
    clearInterval(session.checkpointTimer);
    session.checkpointTimer = null;
  }
  await session.card.finalize();
  await saveSnapshot(session);
  session.unsubscribe();
  session.actor.stop();
}
