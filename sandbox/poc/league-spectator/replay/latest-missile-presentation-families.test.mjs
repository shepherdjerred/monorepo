import { expect, test } from "bun:test";
import {
  combineMissilePresentationFamilies,
  VERIFIED_MISSILE_PRESENTATION_FAMILIES,
} from "./latest-missile-presentation-families.mjs";
const family = (policy) => ({
  policy,
  build: "16.21.829.8620",
  protocol: "20e09df23c66b85e",
  replaySha256: "a".repeat(64),
  endTime: 3,
  traces: [],
  omitted: [],
  summary: { traces: 0, omitted: 0 },
  omissions: [],
});

test("an admitted empty selector replaces only its retained-target rejection", () => {
  const families = VERIFIED_MISSILE_PRESENTATION_FAMILIES.map(family);
  families[1].omitted = [
    {
      sequence: 1,
      sourceEventId: "packet:1",
      reasons: ["target:single-reference"],
    },
    { sequence: 2, sourceEventId: "packet:2", reasons: ["target:unresolved"] },
  ];
  families[2].traces = [
    {
      policy: families[2].policy,
      instanceId: "source:1",
      sourceEventId: "packet:1",
      sequence: 1,
      startTime: 1,
      emittedCastRequests: [],
    },
  ];
  const result = combineMissilePresentationFamilies(...families);
  expect(result.omitted).toEqual([families[1].omitted[1]]);
  expect(result.summary.reasons).toEqual({ "target:unresolved": 1 });
  expect(
    combineMissilePresentationFamilies(...families.slice(0, 2)).omitted,
  ).toEqual(families[1].omitted);
});
test("two original families retain their exact registry while explicit third family owns separate identities", () => {
  const families = VERIFIED_MISSILE_PRESENTATION_FAMILIES.map(family);
  expect(
    combineMissilePresentationFamilies(...families.slice(0, 2)).familyPolicies,
  ).toEqual(VERIFIED_MISSILE_PRESENTATION_FAMILIES.slice(0, 2));
  expect(
    combineMissilePresentationFamilies(...families).familyPolicies,
  ).toEqual([...VERIFIED_MISSILE_PRESENTATION_FAMILIES]);
  families[2].traces.push({
    policy: families[2].policy,
    instanceId: "source:1",
    sequence: 1,
    startTime: 1,
    emittedCastRequests: [],
  });
  const result = combineMissilePresentationFamilies(...families);
  expect(result.traces).toHaveLength(1);
  families[2].traces[0].sequence = 99;
  expect(result.traces[0].sequence).toBe(1);
  families[1].traces.push({
    ...families[2].traces[0],
    policy: families[1].policy,
  });
  expect(() => combineMissilePresentationFamilies(...families)).toThrow(
    "Ambiguous",
  );
});
