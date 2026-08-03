import {
  parseDatasetExport,
  serializeDatasetExport,
} from "#server/dataset-transfer.ts";
import type { EvalStore } from "#server/store.ts";
import type { DatasetSummary } from "#shared/schema.ts";

export async function writeDatasetExportFile(
  store: EvalStore,
  datasetId: string,
  outputPath: string,
): Promise<void> {
  const output = Bun.file(outputPath);
  if (await output.exists()) {
    throw new Error(`Output file already exists: ${outputPath}`);
  }
  const datasetExport = store.exportDataset(datasetId);
  await Bun.write(output, serializeDatasetExport(datasetExport));
}

export async function importDatasetExportFile(
  store: EvalStore,
  inputPath: string,
): Promise<DatasetSummary> {
  const input = Bun.file(inputPath);
  if (!(await input.exists())) {
    throw new Error(`Input file does not exist: ${inputPath}`);
  }
  const datasetExport = parseDatasetExport(await input.text());
  return store.importDataset(datasetExport);
}
