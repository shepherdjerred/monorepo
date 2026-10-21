import { PipelineDefinitionSchema } from "#shared/pipeline-contract.ts";
import { recipeFromPipeline } from "#shared/model/recipe-adapter.ts";

/** A recipe converted from a reviewed v1 registration, optionally overridden. */
export async function registration(
  file: string,
  overrides: Record<string, unknown> = {},
) {
  const raw: unknown = await Bun.file(
    new URL(`../../registrations/${file}`, import.meta.url),
  ).json();
  if (typeof raw !== "object" || raw === null) {
    throw new TypeError(`${file} is not an object`);
  }
  return recipeFromPipeline(
    PipelineDefinitionSchema.parse({ ...raw, ...overrides }),
  );
}

/** A small, valid catalog document over the reviewed registrations. */
export async function catalogDocument() {
  const [arcade, arcadeBeta, delivery] = await Promise.all([
    registration("arcade.pipeline.json"),
    registration("arcade.pipeline.json", {
      application: "arcade-beta",
      namespace: "arcade-beta",
    }),
    registration("ordinary/delivery/pipeline.json"),
  ]);
  const site = recipeFromPipeline(
    PipelineDefinitionSchema.parse({
      kind: "static-site",
      archiveComponent: "site:sjer-red",
      bucket: "sjer-red",
      immutablePrefixes: [],
      extraExcludes: [],
      entrypoints: ["index.html"],
      verification: { url: "https://sjer.red/", expectedStatus: 200 },
    }),
  );
  return {
    groups: [
      { id: "ci", title: "CI", kind: "platform" },
      { id: "arcade", title: "Arcade", kind: "product", package: "arcade" },
      {
        id: "delivery",
        title: "Delivery",
        kind: "platform",
        package: "delivery",
      },
      { id: "static-sites", title: "Static sites", kind: "product" },
    ],
    services: [
      {
        id: "ci",
        title: "CI",
        lifecycle: "active",
        selfHosted: false,
        group: "ci",
        components: [{ name: "image:ci-base", producer: "first-party" }],
      },
      {
        id: "arcade",
        title: "Arcade",
        package: "arcade",
        lifecycle: "active",
        selfHosted: false,
        group: "arcade",
        components: [
          { name: "image:arcade", producer: "first-party" },
          { name: "chart:arcade", producer: "first-party" },
        ],
      },
      {
        id: "delivery",
        title: "Delivery",
        package: "delivery",
        lifecycle: "active",
        selfHosted: true,
        group: "delivery",
        components: [
          { name: "image:delivery", producer: "first-party" },
          { name: "chart:delivery", producer: "first-party" },
        ],
      },
      {
        id: "sjer-red",
        title: "sjer.red",
        lifecycle: "active",
        selfHosted: false,
        group: "static-sites",
        components: [{ name: "archive:sjer-red", producer: "first-party" }],
      },
    ],
    environments: [
      {
        id: "arcade/beta",
        role: "qualification",
        approvalPolicy: "none",
        automatic: true,
        recipeRevisionId: "arcade-beta/1",
        configurationRevisionId: "arcade/1",
      },
      {
        id: "arcade/prod",
        role: "durable",
        approvalPolicy: "required",
        automatic: true,
        promotionSourceEnvironmentId: "arcade/beta",
        recipeRevisionId: "arcade/3",
        configurationRevisionId: "arcade/1",
      },
      {
        id: "delivery/prod",
        role: "durable",
        approvalPolicy: "required",
        automatic: true,
        recipeRevisionId: "delivery/3",
        configurationRevisionId: "delivery/1",
      },
      {
        id: "sjer-red/prod",
        role: "durable",
        approvalPolicy: "none",
        automatic: true,
        recipeRevisionId: "sjer-red/1",
        configurationRevisionId: "sjer-red/1",
      },
    ],
    recipes: [
      { id: "arcade/3", definition: arcade },
      { id: "arcade-beta/1", definition: arcadeBeta },
      { id: "delivery/3", definition: delivery },
      { id: "sjer-red/1", definition: site },
    ],
    configurations: [
      { id: "arcade/1", content: {}, forwardOnly: [] },
      {
        id: "delivery/1",
        content: { "postgres.major": "17" },
        forwardOnly: ["postgres.major"],
      },
      { id: "sjer-red/1", content: {}, forwardOnly: [] },
    ],
    edges: [
      {
        dependent: "arcade/prod",
        prerequisite: "delivery/prod",
        rule: "any-accepted",
      },
      {
        dependent: "sjer-red/prod",
        prerequisite: "delivery/prod",
        rule: "same-or-later-order-key",
      },
    ],
  };
}
