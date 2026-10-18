import {
  PipelineDefinitionSchema,
  RegisterEnvironmentSchema,
} from "#shared/contract.ts";
import { fingerprint } from "#infrastructure/delivery-records.ts";
import { DeliveryError } from "#domain/error.ts";
import type { Environment, PipelineRevision } from "#shared/contract.ts";

/** These are immutable code-reviewed definitions, never a source of selected release state. */
export async function reviewedOwnershipDefinitions() {
  const root = new URL("../../../registrations/", import.meta.url);
  const files = [
    "arcade.pipeline.json",
    ...new Bun.Glob("**/pipeline.json").scanSync({
      cwd: root.pathname,
      onlyFiles: true,
    }),
  ];
  const entries = await Promise.all(
    files.map(async (file) => ({
      environment: RegisterEnvironmentSchema.parse(
        await Bun.file(
          new URL(file.replace(/pipeline\.json$/u, "environment.json"), root),
        ).json(),
      ),
      pipeline: PipelineDefinitionSchema.parse(
        await Bun.file(new URL(file, root)).json(),
      ),
    })),
  );
  const definitions = new Map(
    entries.map((entry) => [entry.environment.id, entry]),
  );
  if (definitions.size !== entries.length)
    throw new Error(
      "Reviewed ownership definitions contain duplicate environments",
    );
  return definitions;
}

export function requireReviewedOwnershipDefinition(
  definitions: Awaited<ReturnType<typeof reviewedOwnershipDefinitions>>,
  environment: Environment,
  pipeline: PipelineRevision,
) {
  const reviewed = definitions.get(environment.id);
  if (
    reviewed?.environment.application !== environment.application ||
    reviewed.environment.serviceId !== environment.serviceId ||
    reviewed.environment.pipelineRevisionId !== pipeline.id ||
    fingerprint(reviewed.pipeline) !== fingerprint(pipeline.definition)
  )
    throw new DeliveryError(
      "CONFLICT",
      "Ownership handover requires the exact code-reviewed registered pipeline and canonical environment identity",
    );
}
