import { z } from "zod";

import { argumentValue, evalDatabasePath } from "#lib/cli.ts";
import { importDatasetExportFile } from "#lib/dataset-transfer-cli.ts";
import { createEvalStore } from "#server/store.ts";

const OptionsSchema = z.strictObject({
  databasePath: z.string().min(1),
  inputPath: z.string().min(1),
});

const options = OptionsSchema.parse({
  databasePath: evalDatabasePath(),
  inputPath: argumentValue("--input"),
});

const store = createEvalStore(options.databasePath);
try {
  const imported = await importDatasetExportFile(store, options.inputPath);
  await Bun.write(
    Bun.stdout,
    `Imported ${imported.key} version ${String(imported.version)} as dataset ${imported.id}\n`,
  );
} finally {
  store.close();
}
