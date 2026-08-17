import path from "node:path";
import { loadVoiceCorpusManifest } from "@shepherdjerred/streambot/voice/corpus-io.ts";
import { decodeDiscordOpusContainer } from "@shepherdjerred/streambot/voice/discord-opus-container.ts";
import {
  CORPUS_DIR,
  assertAcceptedCascade,
  metricSnapshot,
  paceCloudVerification,
  validateReply,
  waitForReplyCompletion,
  type Speaker,
} from "./voice-assistant-support.ts";
import type { VoiceAcceptanceContext } from "./voice-assistant-scenarios.ts";

/**
 * Send only the fixture's speech, then stop the RTP stream entirely — a real Discord client's
 * DTX behavior. The trailing recorded silence is deliberately withheld so endpointing must come
 * from the lifecycle's wall-clock silence injection.
 */
async function speakFixtureDtx(
  speaker: Speaker,
  fixtureId: string,
): Promise<void> {
  const manifest = await loadVoiceCorpusManifest(CORPUS_DIR);
  const entry = manifest.entries.find(
    (candidate) => candidate.id === fixtureId,
  );
  if (entry === undefined)
    throw new Error(`Missing voice corpus fixture ${fixtureId}`);
  if (entry.speechEndMs === null) {
    throw new Error(`Fixture ${fixtureId} records no speechEndMs`);
  }
  if (entry.expected === "wake") {
    await paceCloudVerification(speaker);
  }
  const container = decodeDiscordOpusContainer(
    new Uint8Array(
      await Bun.file(path.join(CORPUS_DIR, entry.file)).arrayBuffer(),
    ),
  );
  const speechPackets = Math.ceil(entry.speechEndMs / 20);
  speaker.connection.mediaConnection.setSpeaking(true);
  try {
    for (const packet of container.packets.slice(0, speechPackets)) {
      speaker.connection.sendAudioFrame(Buffer.from(packet), 20);
      await Bun.sleep(20);
    }
  } finally {
    speaker.connection.mediaConnection.setSpeaking(false);
  }
}

/**
 * A real client's DTX stops RTP at end of speech, so this wake can only endpoint through the
 * lifecycle's wall-clock silence injection. The elapsed bound is the assertion: without
 * injection the turn sits at the 15 s max-utterance timeout before anything reaches the cloud.
 */
export async function runDtxEndpoint(
  context: VoiceAcceptanceContext,
): Promise<void> {
  const before = await metricSnapshot();
  const replyStart = context.speakerOne.packetsFrom(
    context.firstAssistantId,
  ).length;
  const replyPromise = waitForReplyCompletion(
    context.speakerOne,
    context.firstAssistantId,
    replyStart,
  );
  await speakFixtureDtx(context.speakerOne, "clean-positive-036");
  const speechEndedAtMs = Date.now();
  const reply = await replyPromise;
  const firstReplyElapsedMs = Date.now() - speechEndedAtMs;
  validateReply(reply);
  const after = await metricSnapshot();
  assertAcceptedCascade(after, before, 1);
  // Reply completion includes cloud latency and the paced reply itself; the endpoint saving is
  // still unmistakable next to the 15 s timeout floor this scenario would hit without injection.
  if (firstReplyElapsedMs > 10_000) {
    throw new Error(
      `DTX wake took ${String(firstReplyElapsedMs)} ms after speech ended; endpointing likely fell back to the max-utterance timeout`,
    );
  }
}
