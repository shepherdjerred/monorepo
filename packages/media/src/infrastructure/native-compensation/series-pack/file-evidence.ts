import type { SeriesPackNativeFileEvidenceV3 } from "#shared/native-recovery/series-pack/evidence.ts";
import type { SeriesPackNativeCompensationScopeV3 } from "#shared/native-recovery/series-pack/scope.ts";
import type { SeriesPackNativeParentsV1 } from "./parents.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { effectHash } from "#automation/publication-proof/effect-state.ts";
import { publicationRecordNamespace } from "#filesystem/publication-proof/records.ts";
import { canonicalJson } from "#migration/profile-import.ts";
import { z } from "zod";

/** Exact original raw WAL bytes are retained, never synthesized into completed
 * original acquisition/batch history. A partial last batch can extend the real
 * completed SQL parents; a syscall without its actual ACK remains protected.
 */
export function assertSeriesPackNativeFileEvidenceV1(
  scope: SeriesPackNativeCompensationScopeV3,
  graph: SeriesPackNativeParentsV1,
  files: SeriesPackNativeFileEvidenceV3,
) {
  const assertFileHeader1 = () => {
    if (
      files.transitionId !== scope.publication.transitionId ||
      files.intentHash !== scope.publication.intentHash ||
      files.recoveryEpoch !== scope.request.recoveryEpoch ||
      files.effectPrefixHash !== identityHash(files.acknowledgedEffects) ||
      files.effectPrefixRaw !==
        canonicalJson(z.json().parse(files.acknowledgedEffects)) ||
      files.acknowledgedRaw.length !== files.acknowledgedEffects.length ||
      files.inverseNamespace.state !== "absent" ||
      files.inverseNamespace.root !== "control"
    )
      throw new Error(
        "Native pack review changed its exact physical prefix or future namespace",
      );
  };
  assertFileHeader1();
  const assertFileHeader2 = () => {
    if (
      files.inverseNamespace.path !==
      publicationRecordNamespace({
        transitionId: scope.publication.transitionId,
        continuationId: files.planId,
      })
    )
      throw new Error(
        "Native pack review changed its exact physical prefix or future namespace",
      );
  };
  assertFileHeader2();
  let previous: string | null = null;
  for (const [index, effect] of files.acknowledgedEffects.entries()) {
    if (
      effect.ordinal !== index ||
      effect.previousEffectHash !== previous ||
      effect.continuationId !== null ||
      effect.transitionId !== scope.publication.transitionId ||
      effect.intentHash !== scope.publication.intentHash ||
      JSON.stringify(effect) !== files.acknowledgedRaw[index] ||
      !scope.publication.intent.entries.some(
        (item) =>
          item.entry.operationId === effect.entryOperationId &&
          item.entry.libraryKind === effect.libraryKind &&
          [item.entry.assetId, item.entry.previousAssetId].includes(
            effect.assetId,
          ),
      )
    )
      throw new Error(
        "Native pack review does not retain the exact original raw effect chain",
      );
    previous = effectHash(effect);
  }
  for (const forward of graph.forward)
    for (const ref of forward.completion.effects) {
      const actual = files.acknowledgedEffects[ref.ordinal];
      if (
        actual === undefined ||
        effectHash(actual) !== ref.effectHash ||
        actual.libraryKind !== ref.libraryKind ||
        actual.effect.operationId !== ref.operationId ||
        actual.effect.step !== ref.step
      )
        throw new Error(
          "Native pack physical review omitted an actual completed forward receipt",
        );
    }
}
