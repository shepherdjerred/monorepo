import { z } from "zod";
import { IdentifierSchema } from "./artifact-contract.ts";
import type { StoredRecipeDefinition } from "./model/record-contract.ts";

export const CreateDeploymentSchema = z
  .object({
    requestId: IdentifierSchema,
    environmentId: IdentifierSchema,
    versionSetRevisionId: IdentifierSchema,
    expectedGeneration: z.number().int().nonnegative(),
    kind: z
      .enum(["deploy", "promote", "rollback", "adopt-worker"])
      .default("deploy"),
    sourceEnvironmentId: IdentifierSchema.optional(),
    workerBaseline: z
      .strictObject({
        artifactIds: z.array(IdentifierSchema).min(1).max(100),
        candidateArtifactId: IdentifierSchema,
      })
      .optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (
      (input.kind === "adopt-worker") !==
      (input.workerBaseline !== undefined)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Host-only worker adoption requires its explicit original artifact selection",
      });
    const baseline = input.workerBaseline;
    if (
      baseline !== undefined &&
      (new Set(baseline.artifactIds).size !== baseline.artifactIds.length ||
        !baseline.artifactIds.includes(baseline.candidateArtifactId))
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Baseline artifacts must be unique and include the routed candidate",
      });
  });

export const DeploymentKindV2Schema = z.enum([
  "deploy",
  "promote",
  "rollback",
  "rebind",
  "retire-host",
  "channel-publish",
  "operator-run",
]);
export type DeploymentKindV2 = z.infer<typeof DeploymentKindV2Schema>;
/**
 * Kinds the API retries as a new deployment of the same frozen request
 * (`retryRequest`). Specialized kinds need fresh exact inputs instead.
 */
export const RETRYABLE_DEPLOYMENT_KINDS = [
  "deploy",
  "promote",
  "rollback",
  "rebind",
  "channel-publish",
  "operator-run",
] as const satisfies readonly DeploymentKindV2[];

/**
 * What realises a set revision under the stored recipe a release freezes
 * (section 5), read from the stored kind exactly as the server's kind check
 * reads it: a channel recipe is published, an operator-run recipe is run by
 * an attested operator tool, and every other model recipe and v1 pipeline is
 * deployed. A v1 manual pipeline is deployed too; `recipeKindOf` reads it as
 * an operator-run recipe, which admission refuses for it.
 */
export function releaseKindOf(
  recipeKind: StoredRecipeDefinition["kind"],
): Extract<DeploymentKindV2, "deploy" | "channel-publish" | "operator-run"> {
  switch (recipeKind) {
    case "channel": {
      return "channel-publish";
    }
    case "operator-run": {
      return "operator-run";
    }
    case "manual":
    case "kubernetes-application":
    case "static-site":
    case "tofu":
    case "compound":
    case "argocd":
    case "control-plane":
    case "root-release": {
      return "deploy";
    }
  }
}

const RevisionIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*\/[1-9]\d*$/u);

/**
 * A deployment request under the model (4.12). `deploy`, `channel-publish`
 * and `operator-run` name a set revision; `promote` takes the source's
 * accepted one; `rollback` names the deployment whose selection it restores
 * (L1, V2); `rebind` keeps the accepted set revision and names a new recipe
 * or configuration revision (L2); `retire-host` names the retained host.
 * `override` asks for the approval a non-eligible `deploy` requires (H4).
 */
export const CreateDeploymentV2Schema = z
  .strictObject({
    requestId: IdentifierSchema,
    environmentId: IdentifierSchema,
    expectedGeneration: z.number().int().nonnegative(),
    kind: DeploymentKindV2Schema,
    versionSetRevisionId: IdentifierSchema.optional(),
    selectionDeploymentId: IdentifierSchema.optional(),
    recipeRevisionId: RevisionIdSchema.optional(),
    configurationRevisionId: RevisionIdSchema.optional(),
    sourceEnvironmentId: IdentifierSchema.optional(),
    hostId: IdentifierSchema.optional(),
    override: z.boolean().default(false),
    message: z.string().max(4000).optional(),
  })
  .superRefine((input, context) => {
    const refuse = (message: string) => {
      context.addIssue({ code: "custom", message });
    };
    const namesSet = input.versionSetRevisionId !== undefined;
    if (
      !namesSet &&
      (input.kind === "deploy" ||
        input.kind === "channel-publish" ||
        input.kind === "operator-run")
    ) {
      refuse(`${input.kind} names the set revision to realise`);
    }
    if (
      namesSet &&
      (input.kind === "promote" ||
        input.kind === "rollback" ||
        input.kind === "rebind" ||
        input.kind === "retire-host")
    ) {
      refuse(
        `${input.kind} takes its set revision from the environment it reads, not the request`,
      );
    }
    if (
      (input.kind === "rollback") !==
      (input.selectionDeploymentId !== undefined)
    ) {
      refuse(
        "rollback names the deployment whose selection it restores; no other kind does",
      );
    }
    const rebinds =
      input.recipeRevisionId !== undefined ||
      input.configurationRevisionId !== undefined;
    if ((input.kind === "rebind") !== rebinds) {
      refuse(
        "rebind names at least one of a recipe or configuration revision; no other kind does",
      );
    }
    if ((input.kind === "retire-host") !== (input.hostId !== undefined)) {
      refuse(
        "retire-host names the retained host to remove; no other kind does",
      );
    }
    if (
      (input.kind === "promote") !==
      (input.sourceEnvironmentId !== undefined)
    ) {
      refuse(
        "promote names the source environment whose accepted selection it takes; no other kind does",
      );
    }
    if (input.override && input.kind !== "deploy") {
      refuse(
        "Only a deploy of a non-eligible set revision asks for an override approval (H4)",
      );
    }
  });
export type CreateDeploymentV2 = z.infer<typeof CreateDeploymentV2Schema>;
