import {
  delta,
  metricSnapshot,
  speakFixture,
  waitUntil,
} from "./voice-assistant-support.ts";
import type { VoiceMetricSnapshot } from "./voice-assistant-support.ts";
import type { VoiceAcceptanceContext } from "./voice-assistant-scenarios.ts";

function assertExactDeltas(
  after: VoiceMetricSnapshot,
  before: VoiceMetricSnapshot,
  expectations: readonly (readonly [keyof VoiceMetricSnapshot, number])[],
): void {
  for (const [key, expected] of expectations) {
    if (delta(after, before, key) !== expected) {
      throw new Error(
        `Invalid-credential metric ${key} did not change by ${String(expected)}`,
      );
    }
  }
}

/** Live fail-closed probe. Run the E2E harness with an intentionally invalid OpenAI key. */
export async function runInvalidCredentialIsolation(
  context: VoiceAcceptanceContext,
): Promise<void> {
  const before = await metricSnapshot();
  const replyStart = context.speakerOne.packetsFrom(
    context.firstAssistantId,
  ).length;
  const positionBefore = context.first.view().positionSeconds ?? 0;
  const currentBefore = context.first.view().current?.sourceId;
  await speakFixture(context.speakerOne, "clean-positive-005");
  await waitUntil("invalid-credential OpenAI failure", async () => {
    const current = await metricSnapshot();
    return delta(current, before, "failures") === 1;
  });
  await waitUntil("invalid-credential transaction cleanup", async () => {
    const current = await metricSnapshot();
    return current.concurrentTurns === 0;
  });
  await Bun.sleep(1000);
  const after = await metricSnapshot();
  assertExactDeltas(after, before, [
    ["candidates", 1],
    ["localAccepted", 1],
    ["wakes", 1],
    ["transcriptAccepted", 0],
    ["transcriptRejected", 0],
    ["cloudRateLimited", 0],
    ["failures", 1],
    ["commandTurns", 0],
    ["replyPackets", 0],
    ["ducked", 0],
    ["restored", 0],
    ["successfulTools", 0],
    ["deniedTools", 0],
  ]);
  if (
    context.speakerOne.packetsFrom(context.firstAssistantId).length !==
      replyStart ||
    context.first.view().current?.sourceId !== currentBefore ||
    (context.first.view().positionSeconds ?? 0) <= positionBefore ||
    delta(after, before, "ffmpegOutSeconds") <= 0
  ) {
    throw new Error(
      "Invalid OpenAI credentials did not fail closed while playback remained healthy",
    );
  }
}
