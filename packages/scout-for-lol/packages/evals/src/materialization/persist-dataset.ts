import type { MaterializedCase } from "#materialization/materialize-case.ts";
import type { MaterializationDatasetTarget } from "#materialization/spec.ts";
import type { EvalStore } from "#server/store.ts";

type PersistedMaterializedDataset = {
  datasetId: string;
  caseIds: string[];
};

export function validateMaterializationTarget(
  store: EvalStore,
  target: MaterializationDatasetTarget,
): void {
  if (!("datasetId" in target)) return;
  const dataset = store
    .listDatasets()
    .find((candidate) => candidate.id === target.datasetId);
  if (dataset === undefined) {
    throw new Error(`Dataset ${target.datasetId} does not exist`);
  }
  if (dataset.status !== "draft") {
    throw new Error(`Dataset ${target.datasetId} is finalized`);
  }
}

export function persistMaterializedDataset(
  store: EvalStore,
  target: MaterializationDatasetTarget,
  materializedCases: readonly MaterializedCase[],
): PersistedMaterializedDataset {
  return store.runInTransaction(() => {
    validateMaterializationTarget(store, target);
    const datasetId =
      "datasetId" in target
        ? target.datasetId
        : store.createDataset(target.dataset).id;
    const caseIds: string[] = [];
    for (const materializedCase of materializedCases) {
      const summary = store.addMaterializedCase({
        artifact: materializedCase.artifact,
        datasetId,
      });
      store.recordGeneration({
        caseId: summary.id,
        ...materializedCase.generation,
      });
      caseIds.push(summary.id);
    }
    return { datasetId, caseIds };
  });
}
