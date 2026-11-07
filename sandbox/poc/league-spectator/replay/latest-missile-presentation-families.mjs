import { TARGETED_MISSILE_PRESENTATION_POLICY } from "./latest-targeted-missile-presentation.mjs";
import { FIXED_TIME_PRESENTATION_POLICY } from "./latest-fixed-time-presentation.mjs";
import { ZERO_REFERENCE_FIXED_TIME_PRESENTATION_POLICY } from "./latest-zero-reference-fixed-time.mjs";
export const MISSILE_PRESENTATION_FAMILIES_POLICY =
  "native-rofl-verified-partial-missile-families-v1";
export const VERIFIED_MISSILE_PRESENTATION_FAMILIES = Object.freeze([
  TARGETED_MISSILE_PRESENTATION_POLICY,
  FIXED_TIME_PRESENTATION_POLICY,
  ZERO_REFERENCE_FIXED_TIME_PRESENTATION_POLICY,
]);

export function combineMissilePresentationFamilies(
  fixedSpeed,
  fixedTime,
  zeroReference = null,
) {
  const families = [
    fixedSpeed,
    fixedTime,
    ...(zeroReference === null ? [] : [zeroReference]),
  ];
  for (const [index, family] of families.entries())
    if (
      family?.policy !== VERIFIED_MISSILE_PRESENTATION_FAMILIES[index] ||
      ["build", "protocol", "replaySha256", "endTime"].some(
        (key) => family[key] !== fixedSpeed[key],
      ) ||
      !Array.isArray(family.traces) ||
      !Array.isArray(family.omitted)
    )
      throw Error(
        "Matching exact-build missile presentation families required",
      );
  const identities = new Set(),
    traces = [],
    omitted = [],
    reasons = {};
  const admittedZeroReferences = new Set(
    zeroReference?.traces.map((trace) => trace.sourceEventId) ?? [],
  );
  for (const family of families) {
    for (const trace of family.traces) {
      if (trace.policy !== family.policy || identities.has(trace.instanceId))
        throw Error("Ambiguous generated missile family ownership");
      identities.add(trace.instanceId);
      traces.push(structuredClone(trace));
    }
    for (const row of family.omitted) {
      // A FixedTime creation may be rejected by the retained-target policy and
      // admitted by the distinct empty-selector policy. It owns one lifecycle.
      if (family === fixedTime && admittedZeroReferences.has(row.sourceEventId))
        continue;
      omitted.push(structuredClone(row));
      for (const reason of row.reasons)
        reasons[reason] = (reasons[reason] ?? 0) + 1;
    }
  }
  traces.sort((a, b) => a.startTime - b.startTime || a.sequence - b.sequence);
  omitted.sort((a, b) => a.sequence - b.sequence);
  return {
    build: fixedSpeed.build,
    protocol: fixedSpeed.protocol,
    replaySha256: fixedSpeed.replaySha256,
    endTime: fixedSpeed.endTime,
    policy: MISSILE_PRESENTATION_FAMILIES_POLICY,
    familyPolicies: families.map((family) => family.policy),
    traces,
    omitted,
    summary: {
      traces: traces.length,
      omitted: omitted.length,
      reasons,
      emittedCastRequests: traces.reduce(
        (sum, row) => sum + row.emittedCastRequests.length,
        0,
      ),
      families: families.map((family) => ({
        policy: family.policy,
        ...structuredClone(family.summary),
      })),
      rendered: 0,
      nativeAccepted: null,
      complete: null,
    },
    omissions: [...new Set(families.flatMap((family) => family.omissions))],
  };
}
