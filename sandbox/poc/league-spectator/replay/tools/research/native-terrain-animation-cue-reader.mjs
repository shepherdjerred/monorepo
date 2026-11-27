import {
  currentTerrainPositionBuild,
  rotateByteLeft,
  swapAdjacentBits,
  terrainPositionProtocol,
} from "./native-terrain-byte-codecs.mjs";
import { recordedAnimationRequests } from "./recorded-animation-requests.mjs";

// Opcode 669 reader 0x1032910 and callback 0x135ab0. These compact
// forms select the native 1x rate and zero adjustment/override defaults.
const reviewedHeaders = new Set([
  0x39, 0x3b, 0x3f, 0xb9, 0xbb, 0xbf, 0xf9, 0xfb, 0xff,
]);

export function readCurrentAnimationCueRequest(body, substitution) {
  if (!(body instanceof Uint8Array) || body.length < 3 || body.length >= 256)
    return null;
  const [first, second, third] = body;
  if (first !== 0xbe || third !== 0xeb || !reviewedHeaders.has(second))
    return null;

  const layout = (second >>> 1) & 3;
  function decodeStringByte(byte) {
    if (layout === 0)
      return (
        ((0xcd -
          rotateByteLeft(substitution[swapAdjacentBits(byte) ^ 0xa9], 2)) &
          0xff) ^
        0x22
      );
    if (layout === 1)
      return substitution[
        swapAdjacentBits(rotateByteLeft((byte + 0xbc) & 0xff, 3))
      ];
    return (
      (swapAdjacentBits(
        substitution[(rotateByteLeft(substitution[byte], 4) + 0xc7) & 0xff],
      ) +
        0xcf) &
      0xff
    );
  }

  // The reviewed body bound permits at most two string-length digits.
  // For layout zero decodeStringByte leaves continuation bit 7 unchanged.
  let offset = 3;
  if (offset >= body.length) return null;
  const firstDigit = decodeStringByte(body[offset++]);
  let length = firstDigit & 0x7f;
  if (firstDigit >= 0x80) {
    if (offset >= body.length) return null;
    const secondDigit = decodeStringByte(body[offset++]);
    if (secondDigit >= 0x80) return null;
    length |= secondDigit << 7;
  }
  if (length === 0 || body.length - offset !== length) return null;
  const bytes = new Uint8Array(length);
  for (let wire = 0; wire < length; wire++) {
    const half = wire >>> 1;
    const index =
      layout === 0
        ? wire % 2 === 0
          ? half
          : length - 1 - half
        : layout === 1
          ? wire
          : length - 1 - wire;
    bytes[index] = decodeStringByte(body[offset + wire]);
  }
  const name = String.fromCharCode(...bytes);
  if (!/^[A-Za-z0-9_]+$/u.test(name)) return null;
  return { name, rate: 1, flags: second & 0x40 ? 16 : 0 };
}

// Each catalog binding supplies a verified model and an untimed name -> clip
// map. Every actor request closes the previous window, even if we omit its pose.
export function createCurrentChampionAnimationCueAccumulator(
  replay,
  substitution,
  actors,
) {
  if (
    replay?.build !== currentTerrainPositionBuild ||
    replay.protocol !== terrainPositionProtocol
  )
    throw Error("Expected an exact current replay for champion animation cues");
  if (!(substitution instanceof Uint8Array) || substitution.length !== 256)
    throw Error("Expected authenticated champion animation byte substitution");
  const { duration } = replay;
  if (!Number.isFinite(duration) || duration <= 0)
    throw Error("Invalid champion animation replay duration");

  const cues = [];
  const previous = new Map();
  function observe(context, timeSeconds, payload) {
    const actor = actors.get(context);
    if (actor === undefined) return;
    const last = previous.get(context);
    if (
      !Number.isFinite(timeSeconds) ||
      (last !== undefined && timeSeconds < last.timeSeconds)
    )
      throw Error("Invalid champion animation request clock");
    if (last?.cue)
      last.cue.endSeconds = Math.min(last.cue.endSeconds, timeSeconds);

    const state = { timeSeconds, cue: null };
    previous.set(context, state);
    if (timeSeconds < 0 || timeSeconds >= duration) return;
    const request = readCurrentAnimationCueRequest(payload, substitution);
    if (!request) return;
    const asset = actor.actions.get(request.name);
    if (!asset) return;
    const { durationSeconds, rig, clip, bindings } = asset;
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0)
      throw Error("Invalid authored champion animation duration");
    state.cue = {
      participantId: context,
      model: actor.model,
      timeSeconds,
      endSeconds: Math.min(
        timeSeconds + durationSeconds / request.rate,
        duration,
      ),
      rate: request.rate,
      rig,
      clip,
      bindings,
    };
    cues.push(state.cue);
  }

  return {
    observe,
    finish: () => cues.filter((cue) => cue.endSeconds > cue.timeSeconds),
  };
}

export function readCurrentChampionAnimationCues(
  replay,
  decompress,
  substitution,
  actors,
) {
  const accumulator = createCurrentChampionAnimationCueAccumulator(
    replay,
    substitution,
    actors,
  );
  for (const { context, timeSeconds, payload } of recordedAnimationRequests(
    replay,
    decompress,
    actors,
  ))
    accumulator.observe(context, timeSeconds, payload);
  return accumulator.finish();
}
