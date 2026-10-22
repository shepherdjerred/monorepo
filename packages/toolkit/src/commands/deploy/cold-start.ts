import {
  COLD_START_SNAPSHOT,
  SettleRestoreHoldSchema,
  ColdStartSnapshotSchema,
  renderApplication,
} from "@shepherdjerred/delivery/model-contract";
import type { DeliveryClient } from "@shepherdjerred/delivery/client";
import { createS3Client, getObjectText } from "#lib/s3/client.ts";
import { required } from "./common.ts";
import {
  catalogDocument,
  readJson,
  requestId,
  requireMachine,
  type ModelOptions,
  type ModelResult,
  type ObjectReader,
} from "./model-io.ts";

/** The AWS profile whose endpoint and credentials reach R2. */
export const COLD_START_PROFILE = "r2";
const location = `s3://${COLD_START_SNAPSHOT.bucket}/${COLD_START_SNAPSHOT.key}`;

const readR2: ObjectReader = (object) =>
  getObjectText(createS3Client(COLD_START_PROFILE, object.endpoint), object);

export function validateSnapshotCommand(
  positionals: string[],
  options: ModelOptions,
) {
  if (positionals.length === 0) {
    if (options.output === undefined)
      throw new Error(
        "deploy snapshot writes the cold-start snapshot to --output",
      );
    return;
  }
  if (positionals[0] === "accept") {
    required(positionals[1]);
    requireMachine(options, "Accepting a restore hold");
    if (options.reason === undefined) throw new Error("--reason is required");
    if (options.evidence === undefined)
      throw new Error("--evidence is required");
    settlement(options);
    return;
  }
  if (positionals[0] !== "reconcile")
    throw new Error(
      "Use deploy snapshot --output <FILE>, deploy snapshot reconcile, or deploy snapshot accept <ENVIRONMENT>",
    );
  requireMachine(options, "Reconcile after restore");
}

function settlement(options: ModelOptions) {
  return SettleRestoreHoldSchema.parse({
    reason: options.reason,
    evidence: options.evidence,
  });
}

/**
 * `snapshot --output` reads the newest cold-start snapshot from R2 directly,
 * so it works while Delivery is down; `snapshot reconcile` asks Delivery to
 * compare record, snapshot and live target and hold every mismatch.
 */
export async function runSnapshotCommand(
  client: DeliveryClient,
  positionals: string[],
  options: ModelOptions,
): ModelResult {
  validateSnapshotCommand(positionals, options);
  if (positionals[0] === "reconcile") {
    const result = await client.reconcileAfterRestore({
      requestId: requestId(options),
    });
    const held = result.environments.some((entry) => entry.status === "held");
    return { result, exitCode: held ? 1 : 0 };
  }
  if (positionals[0] === "accept") {
    const result = await client.settleRestoreHold(
      required(positionals[1]),
      settlement(options),
    );
    return { result, exitCode: 0 };
  }
  const read = options.readObject ?? readR2;
  const raw: unknown = JSON.parse(await read(COLD_START_SNAPSHOT));
  const snapshot = ColdStartSnapshotSchema.parse(raw);
  const output = required(options.output);
  await Bun.write(output, `${JSON.stringify(snapshot, null, 2)}\n`);
  return {
    result: {
      location,
      output,
      writtenAt: snapshot.writtenAt,
      catalogRevision: snapshot.catalogRevision,
      environments: snapshot.environments.length,
    },
    exitCode: 0,
  };
}

export function validateRenderCommand(options: ModelOptions) {
  if (options.snapshot === undefined)
    throw new Error(
      "deploy render-application reads the snapshot named by --snapshot",
    );
  if (options.file === undefined)
    throw new Error(
      "deploy render-application reads recipes from the catalog document named by --file",
    );
}

/**
 * The Application for one environment from its recipe in the catalog
 * document and the snapshot's accepted selection, with the one sync a cold
 * start needs. Apply it with kubectl; Delivery takes it over afterwards.
 */
export async function runRenderCommand(
  environmentId: string,
  options: ModelOptions,
): ModelResult {
  validateRenderCommand(options);
  const snapshot = ColdStartSnapshotSchema.parse(
    await readJson(required(options.snapshot)),
  );
  const entry = snapshot.environments.find(
    (candidate) => candidate.environmentId === environmentId,
  );
  if (entry === undefined)
    throw new Error(
      `The snapshot records no accepted selection for ${environmentId}`,
    );
  const document = await catalogDocument(options);
  const { recipeRevisionId, configurationRevisionId } = entry.selection;
  const recipe = document.recipes.find(
    (value) => value.id === recipeRevisionId,
  );
  if (recipe === undefined)
    throw new Error(
      `The catalog document has no recipe revision ${recipeRevisionId}`,
    );
  const configuration = document.configurations.find(
    (value) => value.id === configurationRevisionId,
  );
  if (configuration === undefined)
    throw new Error(
      `The catalog document has no configuration revision ${configurationRevisionId}`,
    );
  const application = renderApplication({
    recipe: recipe.definition,
    environmentId,
    configuration: configuration.content,
    artifacts: entry.artifacts,
    initialSync: { requestId: `cold-start/${entry.deploymentId}` },
  });
  return { result: application, exitCode: 0 };
}
