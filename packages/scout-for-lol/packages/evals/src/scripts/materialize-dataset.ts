import { z } from "zod";

import { argumentValue } from "#lib/cli.ts";
import {
  BetaCorpus,
  defaultBetaCorpusPath,
} from "#materialization/beta-corpus.ts";
import { materializeCase } from "#materialization/materialize-case.ts";
import { createOpenAIClient } from "#materialization/openai-client.ts";
import {
  persistMaterializedDataset,
  validateMaterializationTarget,
} from "#materialization/persist-dataset.ts";
import { createS3Client } from "#materialization/s3-source.ts";
import {
  materializationDatasetTarget,
  readMaterializationSpec,
} from "#materialization/spec.ts";
import { createEvalStore } from "#server/store.ts";

const OptionsSchema = z.strictObject({
  apiKey: z.string().min(1),
  corpusPath: z.string().min(1),
  databasePath: z.string().min(1),
  specPath: z.string().min(1),
});

const options = OptionsSchema.parse({
  apiKey: Bun.env["OPENAI_API_KEY"],
  corpusPath: argumentValue("--corpus") ?? defaultBetaCorpusPath(),
  databasePath:
    argumentValue("--database") ??
    Bun.env["SCOUT_EVAL_DATABASE_PATH"] ??
    new URL("../../data/scout-review-evals.sqlite", import.meta.url).pathname,
  specPath: argumentValue("--spec"),
});
const spec = await readMaterializationSpec(options.specPath);
const s3 = createS3Client();
const openai = createOpenAIClient(options.apiKey);
const corpus = new BetaCorpus(options.corpusPath);
try {
  const target = materializationDatasetTarget(spec);
  const store = createEvalStore(options.databasePath);
  try {
    validateMaterializationTarget(store, target);
    const materialized = [];
    for (const [index, caseSpec] of spec.cases.entries()) {
      await Bun.write(
        Bun.stderr,
        `Generating case ${String(index + 1)}/${String(spec.cases.length)}: ${caseSpec.matchKey}\n`,
      );
      materialized.push(
        await materializeCase({ corpus, openai, s3 }, spec.bucket, caseSpec),
      );
    }

    const persisted = persistMaterializedDataset(store, target, materialized);
    await Bun.write(Bun.stdout, `${JSON.stringify(persisted, null, 2)}\n`);
  } finally {
    store.close();
  }
} finally {
  corpus.close();
  s3.destroy();
}
