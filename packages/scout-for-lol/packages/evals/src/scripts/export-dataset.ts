import { z } from "zod";

import { argumentValue, evalDatabasePath } from "#lib/cli.ts";
import { writeDatasetExportFile } from "#lib/dataset-transfer-cli.ts";
import { createEvalStore } from "#server/store.ts";

const OptionsSchema = z.strictObject({
  databasePath: z.string().min(1),
  datasetId: z.string().min(1),
  outputPath: z.string().min(1),
});

const options = OptionsSchema.parse({
  databasePath: evalDatabasePath(),
  datasetId: argumentValue("--dataset"),
  outputPath: argumentValue("--output"),
});

const store = createEvalStore(options.databasePath);
try {
  await writeDatasetExportFile(store, options.datasetId, options.outputPath);
  await Bun.write(
    Bun.stdout,
    `Exported dataset ${options.datasetId} to ${options.outputPath}\n`,
  );
} finally {
  store.close();
}
