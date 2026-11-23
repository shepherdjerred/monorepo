// An explicit research playback boundary, not a recovered native footer rule.
// Whole-container windows preserve original float timestamps whose nearest
// millisecond equals the container's declared integer-millisecond duration.
// Partial windows remain strict. A genuinely later transport tail is rejected.
export function createLatestReconstructionWindow({
  declaredMilliseconds,
  requestedEndTimeSeconds,
}) {
  const declaredDurationSeconds = declaredMilliseconds / 1000,
    wholeContainer = requestedEndTimeSeconds === declaredDurationSeconds;
  if (
    !Number.isFinite(declaredMilliseconds) ||
    declaredMilliseconds < 0 ||
    !Number.isFinite(requestedEndTimeSeconds) ||
    requestedEndTimeSeconds < 0 ||
    requestedEndTimeSeconds > declaredDurationSeconds
  )
    throw Error("Invalid declared replay reconstruction window");
  if (wholeContainer && !Number.isSafeInteger(declaredMilliseconds))
    throw Error(
      "Whole-container playback requires the original integer-millisecond duration",
    );
  let packets = 0,
    gameplayPackets = 0,
    withinRequested = 0,
    recordedTransportEndSeconds = 0,
    recordedGameplayEndSeconds = 0,
    beyondDeclaredPackets = 0,
    finished = false;
  const streams = {},
    tailOpcodes = {};
  return {
    observe(block) {
      if (finished) throw Error("Reconstruction window is finalized");
      if (
        !Number.isFinite(block.time) ||
        block.time < 0 ||
        !Number.isInteger(block.stream) ||
        block.stream < 0 ||
        block.stream > 255 ||
        !Number.isInteger(block.opcode) ||
        block.opcode < 0 ||
        block.opcode > 65535
      )
        throw Error("Original packet timestamp/stream/opcode required");
      packets++;
      streams[block.stream] = (streams[block.stream] ?? 0) + 1;
      recordedTransportEndSeconds = Math.max(
        recordedTransportEndSeconds,
        block.time,
      );
      if ([1, 2].includes(block.stream)) {
        gameplayPackets++;
        recordedGameplayEndSeconds = Math.max(
          recordedGameplayEndSeconds,
          block.time,
        );
        if (block.time <= requestedEndTimeSeconds) withinRequested++;
      }
      if (block.time > declaredDurationSeconds) {
        beyondDeclaredPackets++;
        tailOpcodes[block.opcode] = (tailOpcodes[block.opcode] ?? 0) + 1;
      }
    },
    finish() {
      if (finished) throw Error("Reconstruction window is finalized");
      finished = true;
      if (
        wholeContainer &&
        recordedTransportEndSeconds > declaredDurationSeconds &&
        Math.round(recordedTransportEndSeconds * 1000) !== declaredMilliseconds
      )
        throw Error(
          "Original replay transport extends beyond the declared container millisecond",
        );
      const effectiveEndTimeSeconds = wholeContainer
        ? Math.max(declaredDurationSeconds, recordedTransportEndSeconds)
        : requestedEndTimeSeconds;
      return {
        policy: "explicit-container-millisecond-window-v1",
        scope: wholeContainer ? "whole-container" : "partial",
        declaredDurationMilliseconds: declaredMilliseconds,
        declaredDurationSeconds,
        requestedEndTimeSeconds,
        effectiveEndTimeSeconds,
        recordedTransportEndSeconds,
        recordedGameplayEndSeconds,
        packets,
        gameplayPackets,
        withinRequestedPackets: withinRequested,
        coveredGameplayPackets: wholeContainer
          ? gameplayPackets
          : withinRequested,
        beyondDeclaredPackets,
        tailOpcodes,
        streams,
        originalTimestampsRetained: true,
        nativeFooterRoundingRuleRecovered: false,
      };
    },
  };
}
