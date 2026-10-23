import { describe, expect, test } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import { z } from "zod";
import documentSchema from "@shepherdjerred/ops-model/catalog-document.schema.json" with { type: "json" };
import { catalogOwnsService } from "./core.ts";
import { loadCatalogDocument } from "./files.ts";
import type { CatalogDocument } from "@shepherdjerred/ops-model/catalog-document.ts";
import {
  catalogEnvironmentOf,
  V1_ENVIRONMENT_RENAMES,
  V1_RETIRED_ENVIRONMENTS,
} from "./migration.ts";
import { forumBundlePolicy } from "@shepherdjerred/ops-model/forum-bundle-policy.ts";
import {
  PLATFORM_POLICY,
  TOFU_STACK_POLICIES,
  TofuStackSchema,
} from "@shepherdjerred/ops-model/platform-policy.ts";
import { STATIC_SITE_DESTINATIONS } from "@shepherdjerred/ops-model/static-release-targets.ts";

/**
 * The catalog document is built from today's definition sources, which stay
 * as files until the window retires their v1 readers. Each test pins the
 * document to one source so the two cannot drift.
 */

const document: CatalogDocument = await loadCatalogDocument();
const environments = new Map(
  document.environments.map((environment) => [environment.id, environment]),
);
const recipes = new Map(
  document.recipes.map((recipe) => [recipe.id, recipe.definition]),
);
const edges = new Set(
  document.edges.map((edge) => `${edge.prerequisite} -> ${edge.dependent}`),
);

const LooseDefinitionSchema = z.looseObject({ kind: z.string() });
function recipeOf(
  environmentId: string,
): z.infer<typeof LooseDefinitionSchema> {
  const environment = environments.get(environmentId);
  if (environment === undefined)
    throw new Error(`Catalog has no environment ${environmentId}`);
  return LooseDefinitionSchema.parse(recipes.get(environment.recipeRevisionId));
}

const V1EnvironmentSchema = z.object({
  id: z.string(),
  pipelineRevisionId: z.string(),
  configurationRevision: z.string(),
  configuration: z.record(z.string(), z.string()),
  promotionSourceEnvironmentId: z.string().optional(),
});
const registrationsRoot = new URL(
  "../../../delivery/registrations/",
  import.meta.url,
);
const v1EnvironmentFiles = await Array.fromAsync(
  new Bun.Glob("**/*environment.json").scan({
    cwd: registrationsRoot.pathname,
  }),
);
const v1Environments = await Promise.all(
  v1EnvironmentFiles.map(async (file) =>
    V1EnvironmentSchema.parse(
      await Bun.file(new URL(file, registrationsRoot)).json(),
    ),
  ),
);

describe("catalog document", () => {
  test("the complete document satisfies the language-neutral schema", () => {
    const validate = new Ajv2020({ strict: true }).compile(documentSchema);
    expect(validate(document), JSON.stringify(validate.errors)).toBe(true);
  });
});

/** Promotion the catalog adds: tsmc promotes only what the sandbox qualified. */
const NEW_PROMOTION_SOURCES: Readonly<Record<string, string>> = {
  "minecraft/tsmc": "minecraft/sandbox",
};

describe("agreement with the v1 definition sources", () => {
  test("every v1 environment has its catalog successor and keeps its promotion source", () => {
    for (const v1 of v1Environments) {
      if (V1_RETIRED_ENVIRONMENTS.includes(v1.id)) continue;
      // The launcher's prepared chart renders no Application yet.
      if (v1.id === "glitter-boys-launcher/prod") {
        expect(environments.has(v1.id)).toBe(false);
        continue;
      }
      const successor = environments.get(catalogEnvironmentOf(v1.id));
      expect(successor, v1.id).toBeDefined();
      expect(successor?.promotionSourceEnvironmentId).toBe(
        v1.promotionSourceEnvironmentId === undefined
          ? NEW_PROMOTION_SOURCES[v1.id]
          : catalogEnvironmentOf(v1.promotionSourceEnvironmentId),
      );
    }
  });

  test("no catalog recipe reuses a v1 pipeline revision id, and a reused configuration id keeps its content", () => {
    const pipelineRevisions = new Set(
      v1Environments.map((v1) => v1.pipelineRevisionId),
    );
    for (const recipe of document.recipes)
      expect(pipelineRevisions.has(recipe.id), recipe.id).toBe(false);
    const configurations = new Map(
      document.configurations.map((configuration) => [
        configuration.id,
        configuration,
      ]),
    );
    for (const v1 of v1Environments) {
      const reused = configurations.get(v1.configurationRevision);
      if (reused === undefined) continue;
      expect(reused.content, v1.configurationRevision).toEqual(
        v1.configuration,
      );
      expect(reused.forwardOnly).toEqual([]);
    }
  });

  test("the renames cover exactly the split services", () => {
    for (const [from, to] of Object.entries(V1_ENVIRONMENT_RENAMES)) {
      expect(environments.has(to), to).toBe(true);
      expect(environments.has(from), from).toBe(false);
    }
  });

  test("each OpenTofu stack is its own service with the target its mode allows", () => {
    for (const stack of TofuStackSchema.options) {
      const serviceId = `tofu-${stack}`;
      expect(catalogOwnsService(serviceId), serviceId).toBe(true);
      const { mode } = TOFU_STACK_POLICIES[stack];
      const environmentId = `${serviceId}/prod`;
      if (mode === "validate-only") {
        expect(environments.has(environmentId)).toBe(false);
        continue;
      }
      const recipe = recipeOf(environmentId);
      const tofu = LooseDefinitionSchema.extend({
        stack: z.literal(stack),
        steps: z.array(z.object({ kind: z.string() })),
      }).parse(recipe.kind === "operator-run" ? recipe["wrapped"] : recipe);
      expect(recipe.kind).toBe(
        mode === "operator-only" ? "operator-run" : "tofu",
      );
      expect(tofu.steps.map((step) => step.kind)).toEqual(
        mode === "reviewed-plan"
          ? ["plan", "approve", "apply"]
          : ["plan", "apply"],
      );
      expect(environments.get(environmentId)?.automatic).toBe(
        mode !== "operator-only",
      );
    }
  });

  test("platform policy prerequisites are prerequisite edges", () => {
    for (const [stack, { prerequisites }] of Object.entries(
      TOFU_STACK_POLICIES,
    ))
      for (const prerequisite of prerequisites) {
        const dependent = `tofu-${stack}/prod`;
        if (prerequisite.startsWith("tofu:"))
          expect(edges).toContain(
            `tofu-${prerequisite.slice("tofu:".length)}/prod -> ${dependent}`,
          );
        else if (prerequisite === "static-sites")
          for (const bucket of Object.keys(STATIC_SITE_DESTINATIONS).filter(
            (key) => !key.startsWith("scout-"),
          ))
            expect(edges).toContain(`${bucket}/prod -> ${dependent}`);
        else expect(edges).toContain(`static-site-proxy/prod -> ${dependent}`);
      }
    // The root's three: buckets precede their users, tags precede the
    // operator, and the arr stack follows the media Application it configures.
    expect(PLATFORM_POLICY.rootPrerequisites).toEqual([
      "tofu:seaweedfs",
      "tofu:tailscale",
      "tofu:arr",
    ]);
    expect(edges).toContain("tofu-seaweedfs/prod -> sjer-red/prod");
    expect(edges).toContain("tofu-tailscale/prod -> tailscale/prod");
    expect(edges).toContain("streambot/prod -> tofu-arr/prod");
  });

  test("each reviewed bucket destination is a site service or Scout's combined deployment", () => {
    for (const [bucket, v1] of Object.entries(STATIC_SITE_DESTINATIONS)) {
      const environmentId = catalogEnvironmentOf(v1);
      const recipe = recipeOf(environmentId);
      const buckets =
        recipe.kind === "static-site"
          ? [z.string().parse(recipe["bucket"])]
          : z
              .array(
                z.looseObject({
                  kind: z.string(),
                  policy: z.object({ bucket: z.string() }).optional(),
                }),
              )
              .parse(recipe["steps"])
              .flatMap((step) =>
                step.policy === undefined ? [] : [step.policy.bucket],
              );
      expect(buckets, bucket).toContain(bucket);
      if (recipe.kind === "static-site")
        expect(environmentId).toBe(`${bucket}/prod`);
    }
  });

  test("the forum configuration pins the bundle policy's XenForo version, forward only", () => {
    const configuration = document.configurations.find(
      (candidate) =>
        candidate.id ===
        environments.get("storm-forum/prod")?.configurationRevisionId,
    );
    expect(configuration?.content["forum.xenforoVersion"]).toBe(
      forumBundlePolicy.xenforoVersion,
    );
    // A JSON pointer into the configuration's structured view (F3).
    expect(configuration?.forwardOnly).toEqual([
      "/helm/parameters/forum.xenforoVersion",
    ]);
  });

  test("every environment the prod flag override admits is a catalog or v1 environment", async () => {
    const InventorySchema = z.looseObject({
      environments: z.array(
        z.looseObject({
          overrides: z
            .array(z.looseObject({ key: z.string(), default: z.unknown() }))
            .optional(),
        }),
      ),
    });
    const inventory = InventorySchema.parse(
      await Bun.file(
        new URL(
          "../../../feature-flags/src/managed-flag-inventory.json",
          import.meta.url,
        ),
      ).json(),
    );
    const admitted = inventory.environments
      .flatMap((environment) => environment.overrides ?? [])
      .filter((override) => override.key === "delivery-enabled-environments")
      .flatMap((override) =>
        z
          .array(z.string())
          .parse(JSON.parse(z.string().parse(override.default))),
      );
    expect(admitted.length).toBeGreaterThan(0);
    // The v1 flag still admits the retired root until the window.
    const v1 = new Set([
      ...v1Environments.map((environment) => environment.id),
      ...Object.keys(V1_ENVIRONMENT_RENAMES),
      ...V1_RETIRED_ENVIRONMENTS,
    ]);
    expect(
      admitted.filter((id) => !environments.has(id) && !v1.has(id)),
    ).toEqual([]);
  });
});
