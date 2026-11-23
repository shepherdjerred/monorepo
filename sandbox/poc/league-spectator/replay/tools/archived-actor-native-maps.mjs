import { normalizeProvedNativeActorMap } from "./native-actor-map-bridge.mjs";
import { NATIVE_CLIP_MAP_POLICY } from "./native-clip-map-policy.mjs";
import { NATIVE_EVENT_MAP_POLICY } from "./native-event-map-policy.mjs";

// Observations are explicit operator inputs, selected by complete original BIN
// identity and typed field address. There are no character or skin branches.
export function createActorNativeMapNormalizer(observations, declarations) {
  const parsed = observations.map((bytes) => ({
    bytes,
    proof: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
  }));
  return (opaque, context) => {
    const policy = [NATIVE_CLIP_MAP_POLICY, NATIVE_EVENT_MAP_POLICY].find(
      (value) =>
        value.classHash === context.classHash &&
        value.fieldHash === context.fieldHash,
    );
    if (!policy || opaque.reason !== "duplicate-original-map-keys")
      return undefined;
    const matching = parsed.filter(
      ({ proof }) =>
        proof.sourceBinSha256 === context.sourceBinSha256 &&
        proof.cases?.some(
          (value) =>
            value.classHash === context.classHash &&
            value.fieldHash === context.fieldHash &&
            value.ownerPath === context.ownerPath &&
            JSON.stringify(value.trail) === JSON.stringify(context.trail),
        ),
    );
    if (!matching.length) return undefined;
    if (matching.length !== 1)
      throw Error("Ambiguous source-bound native actor map observations");
    const { value, declaration } = normalizeProvedNativeActorMap({
      kind: policy === NATIVE_CLIP_MAP_POLICY ? "clip" : "event",
      opaque,
      observationBytes: matching[0].bytes,
      sourceBinSha256: context.sourceBinSha256,
      ownerPath: context.ownerPath,
      trail: context.trail,
    });
    declarations.push({
      sourceBinSha256: context.sourceBinSha256,
      ownerPath: context.ownerPath,
      trail: context.trail,
      classHash: context.classHash,
      fieldHash: context.fieldHash,
      ...declaration,
    });
    return value;
  };
}
