import { parseReplaySceneTrace } from "../../../../../../packages/scout-for-lol/packages/replay/src/scene-trace.ts";
import { planPositionComparison } from "./compare-reference-positions.mjs";
import { bindNativeSceneParticipants } from "./native-position-participants.mjs";

export { bindNativeSceneParticipants };

/** Private captured points only. Receipts attest operator identity, not API digest verification. */
export function createNativePositionSceneTrace(
  identity,
  observations,
  references,
) {
  if (!Array.isArray(references) || !references.length)
    throw Error("Native position receipts required");
  const { rows, participants } = bindNativeSceneParticipants(
    identity,
    observations,
  );

  const frames = new Map();
  let minX = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxZ = -Infinity;
  for (const receipt of references) {
    const plan = planPositionComparison(identity, receipt);
    if (!plan.sampleTimes)
      throw Error(
        "Exact point clocks required; bracket-only capture is unavailable",
      );
    for (const { requestedTime, time } of plan.sampleTimes) {
      if (frames.has(time)) throw Error("Duplicate native capture clock");
      const actors = receipt.samples
        .filter((sample) => sample.requestedTime === requestedTime)
        .map((sample) => {
          const [x, , z] = sample.position;
          if (x < 0 || z < 0)
            throw Error(
              "Original negative x/z cannot be represented by this scene contract",
            );
          minX = Math.min(minX, x);
          minZ = Math.min(minZ, z);
          maxX = Math.max(maxX, x);
          maxZ = Math.max(maxZ, z);
          return {
            participantId: rows.get(sample.key),
            x,
            y: z,
            visibleTo: [],
          };
        })
        .sort((a, b) => a.participantId - b.participantId);
      frames.set(time, {
        timeSeconds: time,
        actors,
        directedParticipantId: null,
      });
    }
  }
  if (!(maxX > 0) || !(maxZ > 0))
    throw Error("Positive observed projection extent required");
  const durationSeconds = identity.durationMilliseconds / 1000;
  for (const timeSeconds of [0, durationSeconds])
    if (!frames.has(timeSeconds))
      frames.set(timeSeconds, {
        timeSeconds,
        actors: [],
        directedParticipantId: null,
      });
  const trace = parseReplaySceneTrace({
    durationSeconds,
    width: maxX,
    height: maxZ,
    participants,
    frames: [...frames.values()].sort((a, b) => a.timeSeconds - b.timeSeconds),
  });
  return {
    schemaVersion: 1,
    kind: "local-native-position-scene-trace",
    purpose: "local-verification-only",
    identity: {
      replaySha256: identity.replaySha256,
      build: identity.build,
      protocol: identity.protocol,
      durationMilliseconds: identity.durationMilliseconds,
      participantCount: identity.participantCount,
    },
    projection: {
      x: "original-position-x",
      y: "original-position-z",
      origin: [0, 0],
      observedBounds: { minX, minZ, maxX, maxZ },
      boundsScope: "observed-points-only-not-map-extents",
      sampling: "exact",
      visibility: "unmeasured",
      directedCamera: "unmeasured",
      replayIdentity: "operator-confirmed-not-api-digest-attested",
    },
    trace,
  };
}
