import { createHash } from "node:crypto";
import { z } from "zod";
import { parse } from "yaml";
import type { CiImages } from "#src/images.ts";
import { buildPipelineSteps } from "#src/pipeline/steps.ts";
import { routeSteps } from "#src/pipeline/routing.ts";
import { emitWorkflow } from "#src/pipeline/emit.ts";
import { SOURCE_CACHE_PREPARATION_IMAGE } from "#src/pipeline/source-cache.ts";
import protocol from "#pms-runner-protocol" with { type: "json" };

export const PmsReproductionProtocol = z.fromJSONSchema({
  ...protocol,
  $schema: "http://json-schema.org/draft-07/schema#",
});

const emittedContainer = z.object({
  name: z.string(),
  image: z.string(),
  commands: z.array(z.string()).optional(),
  volumes: z.array(z.string()).optional(),
  backend_options: z.object({
    kubernetes: z.object({
      resources: z.object({
        requests: z.record(z.string(), z.string()),
        limits: z.record(z.string(), z.string()),
      }),
    }),
  }),
});

export const PmsReproductionIdentity = z.strictObject({
  source: z.string().regex(/^[a-f0-9]{40}$/u),
  branch: z.string().min(1),
  requestId: z.uuidv4(),
});

/** Render the real lane for review. This module deliberately cannot launch it. */
export function renderPmsReproduction(
  rawIdentity: z.input<typeof PmsReproductionIdentity>,
  images: CiImages,
) {
  const identity = PmsReproductionIdentity.parse(rawIdentity);
  const selected = buildPipelineSteps({
    images,
    changedBase: undefined,
  }).filter((step) => step.key === "media-pms-wire");
  if (selected.length !== 1) throw new Error("Expected exactly one PMS lane");
  const [lane] = routeSteps(selected, {
    event: "manual",
    branch: identity.branch,
    defaultBranch: "main",
    draft: true,
    maintenance: true,
  });
  if (lane === undefined) throw new Error("PMS lane missing after routing");
  if (
    lane.backend === "local" ||
    lane.skipClone === true ||
    lane.sourceCache !== undefined ||
    (lane.dependsOn?.length ?? 0) !== 0 ||
    (lane.services?.length ?? 0) !== 0
  )
    throw new Error(
      "PMS reproduction must be a standalone Kubernetes workflow",
    );
  const commands = [lane, ...(lane.orderedSteps ?? [])];
  if (
    commands.length !== 2 ||
    commands[1]?.key !== "media-pms-native" ||
    commands.some(
      (command) =>
        (command.secrets?.length ?? 0) !== 0 ||
        command.allowFailure === true ||
        command.retries !== undefined,
    )
  )
    throw new Error(
      "PMS reproduction changed its required two-container contract",
    );
  // The standalone compiler requires an event boundary; the server normally
  // selects extension workflows before compilation.
  const yaml = `when:\n  - event: [manual]\n${emitWorkflow(lane, {
    commit: identity.source,
    branch: identity.branch,
    event: "manual",
    linkUrl: `https://github.com/shepherdjerred/monorepo/commit/${identity.source}`,
  })}`;
  const emitted = z
    .object({
      clone: z.tuple([emittedContainer]),
      steps: z.tuple([emittedContainer, emittedContainer]),
    })
    .parse(parse(yaml));
  const plan = {
    kind: "pms-plan",
    schemaVersion: 1,
    ...identity,
    yamlSha256: createHash("sha256").update(yaml).digest("hex"),
    permissionImage: SOURCE_CACHE_PREPARATION_IMAGE,
    // Exact woodpecker-job refs from homelab's ci/woodpecker-credentials.ts.
    // These authorize kubelet image pulls, never environment or volume mounts.
    jobImagePullSecrets: ["dockerhub-pull-woodpecker-ci"],
    steps: [...emitted.clone, ...emitted.steps].map((command, index) => ({
      name: command.name,
      uuid: `${identity.requestId}-${index.toString()}`,
      image: command.image,
      // emitWorkflow escapes every dollar for Woodpecker substitution. The
      // reviewed plan records the exact commands the runtime will execute.
      commands: (command.commands ?? []).map((value) =>
        value.replaceAll("$$", "$"),
      ),
      resources: command.backend_options.kubernetes.resources,
      volumes: command.volumes ?? [],
    })),
    componentAcceptanceOnly: true,
    policy: {
      backendVersion: "3.19.0",
      namespace: "woodpecker-ci",
      node: "liskov",
      queue: "default",
      workloadPriority: "ci-draft",
      podPriority: "batch-low",
      serviceAccount: "woodpecker-job",
      storageClass: "ci-workspace",
      workspaceSize: "32G",
    },
  };
  PmsReproductionProtocol.parse(plan);
  return { yaml, plan };
}
