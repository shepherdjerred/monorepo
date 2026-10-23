import {
  inspectTrmnlArchive,
  type TrmnlArchiveReader,
} from "@shepherdjerred/ops-clients/trmnl-archive.ts";
import type { createTrmnlPluginClient } from "@shepherdjerred/ops-clients/trmnl.ts";
import type { DeploymentDetail, EvidenceInput } from "#shared/contract.ts";
import { DeliveryError } from "#domain/error.ts";
import { trmnlPluginsOf } from "#shared/model/recipe-view.ts";
import { validateTrmnlSelection } from "./trmnl-policy.ts";

export function createTrmnlRecoveryInspector(options: {
  readArchive: TrmnlArchiveReader;
  client: Pick<ReturnType<typeof createTrmnlPluginClient>, "matches">;
}) {
  return async (detail: DeploymentDetail): Promise<EvidenceInput[]> => {
    const pipeline = detail.pipeline.definition;
    const plugins = trmnlPluginsOf(pipeline);
    if (plugins === undefined)
      throw new DeliveryError(
        "INVALID",
        "TRMNL readback requires the fixed dependency-configured pipeline",
      );
    validateTrmnlSelection(pipeline, detail.versionSet);
    const archive = detail.versionSet.components[plugins.archiveComponent];
    if (archive === undefined)
      throw new DeliveryError("INVALID", "Frozen TRMNL archive is missing");
    const receipt = await inspectTrmnlArchive(archive, options);
    return [
      {
        kind: "runtime",
        operationId: archive.id,
        summary: JSON.stringify({
          adapter: "trmnl-independent-readback",
          archiveArtifactId: archive.id,
          ...receipt,
        }),
      },
    ];
  };
}
