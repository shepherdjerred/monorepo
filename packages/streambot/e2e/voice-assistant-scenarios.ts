import type { Config } from "@shepherdjerred/streambot/config/schema.ts";
import type { SessionManager } from "@shepherdjerred/streambot/session/session-manager.ts";
import type { SessionHandle } from "@shepherdjerred/streambot/session/session-types.ts";
import type {
  ChannelId,
  GuildId,
} from "@shepherdjerred/streambot/types/ids.ts";
import { loadVoiceCorpusManifest } from "@shepherdjerred/streambot/voice/corpus-io.ts";
import {
  CORPUS_DIR,
  assertAcceptedCascade,
  delta,
  metricSnapshot,
  paceCloudVerification,
  runLiveTurn,
  speakFixture,
  speakRawFile,
  validateReply,
  waitForReplyCompletion,
  waitUntil,
  type Speaker,
} from "./voice-assistant-support.ts";
export type VoiceAcceptanceContext = {
  readonly config: Config;
  readonly sessions: SessionManager;
  readonly guildId: GuildId;
  readonly channelIds: readonly [ChannelId, ChannelId];
  readonly first: SessionHandle;
  readonly second: SessionHandle;
  readonly speakerOne: Speaker;
  readonly speakerTwo: Speaker;
  readonly firstAssistantId: string;
  readonly secondAssistantId: string;
};

async function noConcurrentVoiceTurn(): Promise<boolean> {
  const snapshot = await metricSnapshot();
  return snapshot.concurrentTurns === 0;
}

function assertConcurrentMetrics(
  before: Awaited<ReturnType<typeof metricSnapshot>>,
  after: Awaited<ReturnType<typeof metricSnapshot>>,
  replyPackets: number,
): void {
  assertAcceptedCascade(after, before, 2);
  if (
    delta(after, before, "wakes") !== 2 ||
    delta(after, before, "commandTurns") !== 2 ||
    delta(after, before, "successfulTools") !== 2 ||
    delta(after, before, "replyPackets") !== replyPackets ||
    delta(after, before, "ducked") !== 2 ||
    delta(after, before, "restored") !== 2 ||
    delta(after, before, "failures") !== 0 ||
    delta(after, before, "audioTokens") <= 0 ||
    delta(after, before, "repliesWithinTenSeconds") !== 2 ||
    delta(after, before, "wakeToReplyCount") !== 2
  ) {
    throw new Error(
      "Concurrent voice scenario produced unexpected metric deltas",
    );
  }
}
export async function assertDaveReadiness(
  context: VoiceAcceptanceContext,
): Promise<void> {
  await Promise.all([
    waitUntil("first assistant DAVE readiness", () =>
      context.first.assistantDaveReady(),
    ),
    waitUntil("second assistant DAVE readiness", () =>
      context.second.assistantDaveReady(),
    ),
    waitUntil(
      "first speaker DAVE readiness",
      () => context.speakerOne.connection.mediaConnection.daveReady,
    ),
    waitUntil(
      "second speaker DAVE readiness",
      () => context.speakerTwo.connection.mediaConnection.daveReady,
    ),
  ]);
}
export async function runConcurrentIsolation(
  context: VoiceAcceptanceContext,
): Promise<void> {
  const before = await metricSnapshot();
  const firstReplyStart = context.speakerOne.packetsFrom(
    context.firstAssistantId,
  ).length;
  const secondReplyStart = context.speakerTwo.packetsFrom(
    context.secondAssistantId,
  ).length;
  const firstPositionBefore = context.first.view().positionSeconds ?? 0;
  const secondPositionBefore = context.second.view().positionSeconds ?? 0;
  const firstReplyPromise = waitForReplyCompletion(
    context.speakerOne,
    context.firstAssistantId,
    firstReplyStart,
  );
  const secondReplyPromise = waitForReplyCompletion(
    context.speakerTwo,
    context.secondAssistantId,
    secondReplyStart,
  );
  await Promise.all([
    Bun.env["E2E_VOICE_RAW_FILE"] === undefined
      ? speakFixture(context.speakerOne, "clean-positive-016")
      : speakRawFile(
          context.speakerOne,
          Bun.env["E2E_VOICE_RAW_FILE"],
          context.config.ffmpegPath,
        ),
    speakFixture(context.speakerTwo, "clean-positive-017"),
  ]);
  await Promise.all([
    waitUntil(
      "local tool result",
      () => context.first.view().queue[0]?.kind === "file",
    ),
    waitUntil(
      "YouTube tool result",
      () => context.second.view().queue[0]?.kind === "search",
    ),
  ]);
  const [firstReply, secondReply] = await Promise.all([
    firstReplyPromise,
    secondReplyPromise,
  ]);
  validateReply(firstReply);
  validateReply(secondReply);
  const after = await metricSnapshot();
  assertConcurrentMetrics(
    before,
    after,
    firstReply.length + secondReply.length,
  );
  await Bun.sleep(1500);
  if (delta(await metricSnapshot(), after, "wakes") !== 0) {
    throw new Error("Assistant reply triggered its own wake detector");
  }
  if (
    (context.first.view().positionSeconds ?? 0) <= firstPositionBefore ||
    (context.second.view().positionSeconds ?? 0) <= secondPositionBefore ||
    delta(after, before, "ffmpegOutSeconds") <= 0
  ) {
    throw new Error(
      "Go Live playback did not advance continuously through replies",
    );
  }
  if (
    context.first.view().queue.length !== 1 ||
    context.second.view().queue.length !== 1
  ) {
    throw new Error("Simultaneous sessions crossed queue state");
  }
}
export async function runAuthorizationAndQueries(
  context: VoiceAcceptanceContext,
): Promise<void> {
  const denialBefore = await metricSnapshot();
  const denialReplyStart = context.speakerTwo.packetsFrom(
    context.secondAssistantId,
  ).length;
  const currentBeforeDenial = context.second.view().current?.sourceId;
  await speakFixture(context.speakerTwo, "clean-positive-005");
  const denialReply = await waitForReplyCompletion(
    context.speakerTwo,
    context.secondAssistantId,
    denialReplyStart,
  );
  validateReply(denialReply);
  const denialAfter = await metricSnapshot();
  assertAcceptedCascade(denialAfter, denialBefore, 1);
  if (
    delta(denialAfter, denialBefore, "wakes") !== 1 ||
    delta(denialAfter, denialBefore, "deniedTools") !== 1 ||
    delta(denialAfter, denialBefore, "replyPackets") !== denialReply.length ||
    delta(denialAfter, denialBefore, "ducked") !== 1 ||
    delta(denialAfter, denialBefore, "restored") !== 1 ||
    delta(denialAfter, denialBefore, "repliesWithinTenSeconds") !== 1 ||
    delta(denialAfter, denialBefore, "wakeToReplyCount") !== 1 ||
    context.second.view().current?.sourceId !== currentBeforeDenial
  ) {
    throw new Error(
      "Non-requester denial scenario changed state or metrics unexpectedly",
    );
  }

  const queryBefore = await metricSnapshot();
  for (const fixtureId of [
    "clean-positive-015",
    "clean-positive-014",
  ] as const) {
    const start = context.speakerOne.packetsFrom(
      context.firstAssistantId,
    ).length;
    await speakFixture(context.speakerOne, fixtureId);
    validateReply(
      await waitForReplyCompletion(
        context.speakerOne,
        context.firstAssistantId,
        start,
      ),
    );
  }
  const queryAfter = await metricSnapshot();
  assertAcceptedCascade(queryAfter, queryBefore, 2);
  if (
    delta(queryAfter, queryBefore, "wakes") !== 2 ||
    delta(queryAfter, queryBefore, "successfulTools") !== 2 ||
    delta(queryAfter, queryBefore, "commandTurns") !== 0 ||
    delta(queryAfter, queryBefore, "repliesWithinTenSeconds") !== 2 ||
    delta(queryAfter, queryBefore, "wakeToReplyCount") !== 2
  ) {
    throw new Error("Back-to-back query-only turns produced unexpected deltas");
  }
}
async function runSourceAndSeekTools(
  context: VoiceAcceptanceContext,
): Promise<void> {
  const autoQueueLength = context.first.view().queue.length;
  const autoTurn = await runLiveTurn({
    speaker: context.speakerOne,
    assistantUserId: context.firstAssistantId,
    fixtureId: "clean-positive-003",
  });
  await waitUntil(
    "auto local-first queue result",
    () => context.first.view().queue.length === autoQueueLength + 1,
  );
  if (
    context.first.view().queue.at(-1)?.kind !== "file" ||
    delta(autoTurn.after, autoTurn.before, "successfulTools") !== 1
  ) {
    throw new Error("Auto source resolution did not remain local-first");
  }

  const localFailureQueueLength = context.first.view().queue.length;
  const localFailure = await runLiveTurn({
    speaker: context.speakerOne,
    assistantUserId: context.firstAssistantId,
    fixtureId: "clean-positive-004",
  });
  if (
    context.first.view().queue.length !== localFailureQueueLength ||
    delta(localFailure.after, localFailure.before, "deniedTools") !== 1 ||
    delta(localFailure.after, localFailure.before, "successfulTools") !== 0
  ) {
    throw new Error("Explicit local failure fell through or mutated the queue");
  }

  const seekBefore = context.first.view().positionSeconds ?? 0;
  const seekTurn = await runLiveTurn({
    speaker: context.speakerOne,
    assistantUserId: context.firstAssistantId,
    fixtureId: "clean-positive-008",
  });
  if (
    delta(seekTurn.after, seekTurn.before, "successfulTools") !== 1 ||
    (context.first.view().positionSeconds ?? seekBefore) >= seekBefore
  ) {
    throw new Error("Relative seek did not move playback backward");
  }
}

async function runVolumeAndLoopTools(
  context: VoiceAcceptanceContext,
): Promise<void> {
  await runLiveTurn({
    speaker: context.speakerOne,
    assistantUserId: context.firstAssistantId,
    fixtureId: "clean-positive-009",
  });
  if (context.first.view().volume !== 60) {
    throw new Error("Voice volume tool did not set 60 percent");
  }

  const before = await metricSnapshot();
  const replyStart = context.speakerOne.packetsFrom(
    context.firstAssistantId,
  ).length;
  await speakFixture(context.speakerOne, "clean-positive-014");
  await waitUntil(
    "assistant reply before desired-volume change",
    () =>
      context.speakerOne.packetsFrom(context.firstAssistantId).length >
      replyStart,
  );
  context.first.dispatch({ type: "SET_VOLUME", volume: 35 });
  await context.first.setVolume(35);
  validateReply(
    await waitForReplyCompletion(
      context.speakerOne,
      context.firstAssistantId,
      replyStart,
    ),
  );
  const after = await metricSnapshot();
  if (
    context.first.view().volume !== 35 ||
    delta(after, before, "ducked") !== 1 ||
    delta(after, before, "restored") !== 1
  ) {
    throw new Error(
      "Desired-volume change while ducked did not restore to the latest value",
    );
  }

  for (const [fixtureId, expectedLoop] of [
    ["clean-positive-010", "track"],
    ["clean-positive-011", "queue"],
    ["clean-positive-012", "off"],
  ] as const) {
    await runLiveTurn({
      speaker: context.speakerOne,
      assistantUserId: context.firstAssistantId,
      fixtureId,
    });
    if (context.first.view().loop !== expectedLoop) {
      throw new Error(`Voice loop tool did not set ${expectedLoop}`);
    }
  }
}

async function runMutationBoundaries(
  context: VoiceAcceptanceContext,
): Promise<void> {
  const shuffleTurn = await runLiveTurn({
    speaker: context.speakerOne,
    assistantUserId: context.firstAssistantId,
    fixtureId: "clean-positive-013",
  });
  if (delta(shuffleTurn.after, shuffleTurn.before, "successfulTools") !== 1) {
    throw new Error("Voice shuffle tool did not execute");
  }

  for (const fixtureId of [
    "clean-positive-019",
    "clean-positive-020",
  ] as const) {
    const queueLength = context.first.view().queue.length;
    const boundary = await runLiveTurn({
      speaker: context.speakerOne,
      assistantUserId: context.firstAssistantId,
      fixtureId,
    });
    if (
      context.first.view().queue.length !== queueLength ||
      delta(boundary.after, boundary.before, "successfulTools") !== 0
    ) {
      throw new Error(`Boundary request ${fixtureId} changed playback`);
    }
  }

  const mutationLimit = await runLiveTurn({
    speaker: context.speakerOne,
    assistantUserId: context.firstAssistantId,
    fixtureId: "clean-positive-021",
  });
  if (delta(mutationLimit.after, mutationLimit.before, "successfulTools") > 1) {
    throw new Error("A live wake executed more than one mutation");
  }

  const skipTurn = await runLiveTurn({
    speaker: context.speakerOne,
    assistantUserId: context.firstAssistantId,
    fixtureId: "clean-positive-005",
  });
  if (delta(skipTurn.after, skipTurn.before, "successfulTools") !== 1) {
    throw new Error("Requester/admin skip did not execute");
  }
}

export async function runToolMatrix(
  context: VoiceAcceptanceContext,
): Promise<void> {
  await runSourceAndSeekTools(context);
  await runVolumeAndLoopTools(context);
  await runMutationBoundaries(context);
}

export async function runOverlappingSpeakers(
  context: VoiceAcceptanceContext,
): Promise<void> {
  await context.speakerTwo.moveTo(context.guildId, context.channelIds[0]);
  try {
    await waitUntil(
      "overlap speaker DAVE readiness",
      () => context.speakerTwo.connection.mediaConnection.daveReady,
    );
    const before = await metricSnapshot();
    const queueLength = context.first.view().queue.length;
    const replyStart = context.speakerOne.packetsFrom(
      context.firstAssistantId,
    ).length;
    await paceCloudVerification(context.speakerOne);
    await Promise.all([
      speakFixture(context.speakerOne, "clean-positive-014", false),
      speakFixture(context.speakerTwo, "clean-positive-005", false),
    ]);
    await waitUntil("overlapping speaker wake", async () => {
      const current = await metricSnapshot();
      return delta(current, before, "wakes") >= 1;
    });
    const reply = await waitForReplyCompletion(
      context.speakerOne,
      context.firstAssistantId,
      replyStart,
    );
    validateReply(reply);
    await waitUntil(
      "overlapping speaker turn completion",
      noConcurrentVoiceTurn,
    );
    const after = await metricSnapshot();
    assertAcceptedCascade(after, before, 1);
    if (
      delta(after, before, "wakes") !== 1 ||
      delta(after, before, "successfulTools") > 1 ||
      delta(after, before, "replyPackets") !== reply.length ||
      delta(after, before, "repliesWithinTenSeconds") !== 1 ||
      delta(after, before, "wakeToReplyCount") !== 1 ||
      context.first.view().queue.length !== queueLength
    ) {
      throw new Error(
        "Overlapping speakers bypassed single-flight speaker locking",
      );
    }
  } finally {
    await context.speakerTwo.moveTo(context.guildId, context.channelIds[1]);
  }
}

export async function runNegativeSoak(
  context: VoiceAcceptanceContext,
): Promise<void> {
  const soakMinutes = Number(
    Bun.env["E2E_VOICE_NEGATIVE_SOAK_MINUTES"] ?? "30",
  );
  if (!Number.isFinite(soakMinutes) || soakMinutes <= 0) {
    throw new Error("E2E_VOICE_NEGATIVE_SOAK_MINUTES must be positive");
  }
  const manifest = await loadVoiceCorpusManifest(CORPUS_DIR);
  const negatives = manifest.entries.filter(
    (entry) => entry.expected === "no-wake",
  );
  const before = await metricSnapshot();
  const deadline = Date.now() + soakMinutes * 60_000;
  let negativeIndex = 0;
  while (Date.now() < deadline) {
    const negative = negatives[negativeIndex % negatives.length];
    if (negative === undefined) {
      throw new Error("Voice corpus has no live soak negatives");
    }
    await speakFixture(context.speakerOne, negative.id);
    negativeIndex += 17;
  }
  await Bun.sleep(2000);
  const after = await metricSnapshot();
  const candidates = delta(after, before, "candidates");
  const localAccepted = delta(after, before, "localAccepted");
  const transcriptRejected = delta(after, before, "transcriptRejected");
  const rateLimited = delta(after, before, "cloudRateLimited");
  if (
    candidates < localAccepted ||
    localAccepted !== transcriptRejected + rateLimited ||
    delta(after, before, "transcriptAccepted") !== 0 ||
    delta(after, before, "commandTurns") !== 0 ||
    delta(after, before, "successfulTools") !== 0 ||
    delta(after, before, "deniedTools") !== 0 ||
    delta(after, before, "replyPackets") !== 0 ||
    delta(after, before, "audioTokens") !== 0 ||
    after.concurrentTurns !== 0 ||
    delta(after, before, "ffmpegOutSeconds") <= 0
  ) {
    throw new Error(
      "Negative live soak produced a reply, command, or interrupted playback",
    );
  }
}

export async function runStopAndTeardown(
  context: VoiceAcceptanceContext,
): Promise<void> {
  const stopTurn = await runLiveTurn({
    speaker: context.speakerOne,
    assistantUserId: context.firstAssistantId,
    fixtureId: "clean-positive-006",
  });
  if (delta(stopTurn.after, stopTurn.before, "successfulTools") !== 1) {
    throw new Error("Admin stop did not execute or finish its confirmation");
  }
  await waitUntil(
    "stopped session teardown",
    () =>
      context.sessions.getExisting(context.guildId, context.channelIds[0]) ===
      null,
  );
}
