import { TrainingMaps } from "./plan.ts";

/** Contract-only identities; never terrain, recordings or native acceptance. */
export const unitMaps = TrainingMaps.parse({
  schema: 1,
  kind: "rwf-training-maps",
  maps: [
    {
      map: "unit-map",
      blocksSha256: "a".repeat(64),
      scenarioSha256: "b".repeat(64),
    },
  ],
});
