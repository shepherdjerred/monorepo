import type { MaterializedCase } from "#materialization/materialize-case.ts";
import { type CreateDatasetInput, type EvalStore } from "#server/store.ts";

type PersistedMaterializedDataset = {
  datasetId: string;
  caseIds: string[];
};

export function persistMaterializedDataset(
  store: EvalStore,
  datasetInput: CreateDatasetInput,
  materializedCases: readonly MaterializedCase[],
): PersistedMaterializedDataset {
  return store.runInTransaction(() => {
    const dataset = store.createDataset(datasetInput);
    const caseIds: string[] = [];
    for (const materializedCase of materializedCases) {
      const summary = store.addMaterializedCase({
        artifact: materializedCase.artifact,
        datasetId: dataset.id,
      });
      store.recordGeneration({
        caseId: summary.id,
        ...materializedCase.generation,
      });
      caseIds.push(summary.id);
    }
    return { datasetId: dataset.id, caseIds };
  });
}
