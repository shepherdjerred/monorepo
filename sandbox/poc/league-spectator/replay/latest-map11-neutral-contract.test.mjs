import { expect, test } from "bun:test";
import * as map from "./latest-map11-neutral-contract.mjs";
import {
  approvedWorldStateReferenceSha,
  WORLD_STATE_SHA,
} from "./latest-world-state-contract.mjs";
import {
  approvedCorpsePolicyReferenceSha,
  CORPSE_POLICY_SHA,
} from "./latest-corpse-contract.mjs";
import {
  approvedEffectPacketReferenceSha,
  EFFECT_PLACEMENT_PACKAGE_SHA,
} from "./latest-effect-packet-contract.mjs";
test("two-replay neutral corpus selects independently regenerated programs only for its exact world and scene", () => {
  for (const prefix of ["NEUTRAL", "ORDINAL", "CORPUS"]) {
    expect(
      approvedWorldStateReferenceSha(
        11,
        map[`MAP11_${prefix}_WORLD_CATALOG_SHA`],
      ),
    ).toBe(map[`MAP11_${prefix}_WORLD_STATE_SHA`]);
    expect(
      approvedCorpsePolicyReferenceSha(
        11,
        map[`MAP11_${prefix}_WORLD_CATALOG_SHA`],
      ),
    ).toBe(map[`MAP11_${prefix}_CORPSE_POLICY_SHA`]);
    expect(
      approvedEffectPacketReferenceSha(
        "placement",
        11,
        map[`MAP11_${prefix}_SCENE_SHA`],
      ),
    ).toBe(map[`MAP11_${prefix}_EFFECT_PLACEMENT_SHA`]);
    expect(
      approvedEffectPacketReferenceSha(
        "descriptor",
        11,
        map[`MAP11_${prefix}_SCENE_SHA`],
      ),
    ).toBe(map[`MAP11_${prefix}_EFFECT_DESCRIPTOR_SHA`]);
  }
  for (const unknown of ["f".repeat(64), map.MAP11_CORPUS_SCENE_SHA]) {
    expect(() => approvedWorldStateReferenceSha(11, unknown)).toThrow();
    expect(() => approvedCorpsePolicyReferenceSha(11, unknown)).toThrow();
  }
  expect(() =>
    approvedEffectPacketReferenceSha(
      "placement",
      11,
      map.MAP11_CORPUS_WORLD_CATALOG_SHA,
    ),
  ).toThrow();
  expect(
    approvedWorldStateReferenceSha(12, map.MAP11_CORPUS_WORLD_CATALOG_SHA),
  ).toBe(WORLD_STATE_SHA);
  expect(
    approvedCorpsePolicyReferenceSha(12, map.MAP11_CORPUS_WORLD_CATALOG_SHA),
  ).toBe(CORPSE_POLICY_SHA);
  expect(
    approvedEffectPacketReferenceSha(
      "placement",
      12,
      map.MAP11_CORPUS_SCENE_SHA,
    ),
  ).toBe(EFFECT_PLACEMENT_PACKAGE_SHA);
  expect(
    map.isApprovedMap11NeutralCharacterRecordsProof(
      map.MAP11_CORPUS_CHARACTER_RECORDS_PROOF_SHA,
    ),
  ).toBe(true);
  expect(
    map.isApprovedMap11NeutralCharacterRecordsProof(
      map.MAP11_NEUTRAL_CHARACTER_RECORDS_PROOF_SHA,
    ),
  ).toBe(true);
  expect(map.isApprovedMap11NeutralCharacterRecordsProof("a".repeat(64))).toBe(
    false,
  );
});
