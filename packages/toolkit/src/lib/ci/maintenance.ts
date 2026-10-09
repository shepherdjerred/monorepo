import {
  getPipeline,
  listPipelines,
  pipelineUrl,
  type WoodpeckerConfig,
  type WoodpeckerPipeline,
} from "#lib/woodpecker/ci.ts";

export function maintenanceKind(pipeline: WoodpeckerPipeline) {
  if (pipeline.event !== "manual" || pipeline.branch !== "main") return null;
  const name = pipeline.workflows.find((workflow) =>
    workflow.name.startsWith("maintenance-"),
  )?.name;
  if (name === "maintenance-release-notes") return "release-notes";
  if (name === "maintenance-ci-images") return "ci-images";
  return name === "maintenance-superseded" ? "superseded" : null;
}

export async function ciMaintenance(config: WoodpeckerConfig) {
  const listed = await listPipelines(config, {
    event: "manual",
    branch: "main",
    stopWhen: (rows) => rows.length >= 50,
  });
  const pipelines: WoodpeckerPipeline[] = [];
  for (let index = 0; index < listed.length; index += 4) {
    const batch = await Promise.all(
      listed
        .slice(index, index + 4)
        .map((entry) => getPipeline(entry.number, config)),
    );
    pipelines.push(...batch);
  }
  return {
    inspectedManualRuns: listed.length,
    runs: pipelines.flatMap((pipeline) => {
      const kind = maintenanceKind(pipeline);
      return kind === null
        ? []
        : [
            {
              kind,
              pipeline: pipeline.number,
              source: pipeline.commit,
              status: pipeline.status,
              started: pipeline.started ?? null,
              finished: pipeline.finished ?? null,
              url: pipelineUrl(pipeline, config),
            },
          ];
    }),
    coordinator: {
      namespace: "prod",
      workflowId: "ci-maintenance-coordinator",
      memoKey: "ciMaintenance",
    },
    guidance:
      "Maintenance does not satisfy main verification. Inspect failures and the durable coordinator state before retrying; unknown submissions require read-back. Generated PRs remain drafts until a human marks them ready.",
  };
}
