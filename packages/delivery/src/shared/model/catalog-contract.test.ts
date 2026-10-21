import { describe, expect, test } from "vitest";
import {
  CatalogDocumentSchema,
  canonicalJson,
  catalogRevision,
  serviceLineage,
} from "./catalog-contract.ts";
import { PipelineDefinitionSchema } from "#shared/pipeline-contract.ts";
import { recipeFromPipeline } from "./recipe-adapter.ts";

async function registration(
  file: string,
  overrides: Record<string, unknown> = {},
) {
  const raw: unknown = await Bun.file(
    new URL(`../../../registrations/${file}`, import.meta.url),
  ).json();
  if (typeof raw !== "object" || raw === null) {
    throw new TypeError(`${file} is not an object`);
  }
  return recipeFromPipeline(
    PipelineDefinitionSchema.parse({ ...raw, ...overrides }),
  );
}

async function document() {
  const [arcade, arcadeBeta, delivery, site] = await Promise.all([
    registration("arcade.pipeline.json"),
    registration("arcade.pipeline.json", {
      application: "arcade-beta",
      namespace: "arcade-beta",
    }),
    registration("ordinary/delivery/pipeline.json"),
    registration("static/sjer-red/pipeline.json"),
  ]);
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

function issues(value: unknown): string {
  const result = CatalogDocumentSchema.safeParse(value);
  return result.success
    ? ""
    : result.error.issues.map((issue) => issue.message).join("\n");
}

type Document = Awaited<ReturnType<typeof document>>;
type ApplicationRecipe = Extract<
  Document["recipes"][number]["definition"],
  { kind: "kubernetes-application" }
>;
function withApplicationRecipe(
  base: Document,
  id: string,
  change: (definition: ApplicationRecipe) => ApplicationRecipe,
): Document {
  return {
    ...base,
    recipes: base.recipes.map((recipe) => {
      if (recipe.id !== id) return recipe;
      if (recipe.definition.kind !== "kubernetes-application")
        throw new Error(`${id} is not a kubernetes-application recipe`);
      return { ...recipe, definition: change(recipe.definition) };
    }),
  };
}

describe("CatalogDocumentSchema", () => {
  test("accepts recipes converted from the reviewed registrations", async () => {
    const parsed = CatalogDocumentSchema.parse(await document());
    expect(parsed.recipes.map((recipe) => recipe.definition.kind)).toEqual([
      "kubernetes-application",
      "kubernetes-application",
      "kubernetes-application",
      "static-site",
    ]);
  });

  test("refuses two environments naming one target instance (T6)", async () => {
    const base = await document();
    expect(
      issues({
        ...base,
        environments: base.environments.map((environment) =>
          environment.id === "arcade/beta"
            ? { ...environment, recipeRevisionId: "arcade/3" }
            : environment,
        ),
      }),
    ).toMatch(
      /Instance application:arcade is named by both arcade\/beta and arcade\/prod \(T6\)/u,
    );
  });

  test("refuses a recipe that binds a component its service does not declare (P3)", async () => {
    const base = await document();
    expect(
      issues({
        ...base,
        services: base.services.map((service) =>
          service.id === "arcade"
            ? { ...service, components: [service.components[0]] }
            : service,
        ),
      }),
    ).toMatch(/binds chart:arcade, which arcade does not declare \(P3\)/u);
  });

  test("refuses a runner reference the catalog does not declare (A5)", async () => {
    const base = await document();
    expect(
      issues({
        ...base,
        services: base.services.map((service) =>
          service.id === "ci" ? { ...service, components: [] } : service,
        ),
      }),
    ).toMatch(/runs on ci image:ci-base, which the catalog does not declare/u);
  });

  test("refuses an AppProject without an owner or an edge to it (Z3)", async () => {
    const base = await document();
    const withProject = (project: string) =>
      withApplicationRecipe(base, "arcade/3", (definition) => ({
        ...definition,
        application: { ...definition.application, project },
      }));
    expect(issues(withProject("workloads"))).toMatch(
      /arcade\/prod names AppProject workloads, which no catalog service owns/u,
    );
    const owned = {
      ...withProject("workloads"),
      services: base.services.map((service) =>
        service.id === "delivery"
          ? { ...service, appProjects: ["workloads"] }
          : service,
      ),
    };
    // The fixture's arcade/prod -> delivery/prod edge orders it after the owner.
    expect(CatalogDocumentSchema.safeParse(owned).success).toBe(true);
    expect(
      issues({
        ...owned,
        edges: base.edges.filter((edge) => edge.dependent !== "arcade/prod"),
      }),
    ).toMatch(
      /arcade\/prod needs a prerequisite edge to an environment of delivery, which owns AppProject workloads/u,
    );
  });

  test("refuses an accepted-in binding outside the service (A5)", async () => {
    const base = await document();
    const binding = (acceptedIn: string) =>
      withApplicationRecipe(base, "arcade-beta/1", (definition) => ({
        ...definition,
        artifactParameters: {
          ...definition.artifactParameters,
          "delivery.images.accepted": { component: "image:arcade", acceptedIn },
        },
      }));
    expect(issues(binding("delivery/prod"))).toMatch(
      /arcade\/beta binds an image accepted in delivery\/prod, which is not another environment of arcade/u,
    );
    expect(
      CatalogDocumentSchema.safeParse(binding("arcade/prod")).success,
    ).toBe(true);
  });

  test("keeps the ops-model graph rules: promotion tree and prerequisite DAG", async () => {
    const base = await document();
    expect(
      issues({
        ...base,
        edges: [
          ...base.edges,
          {
            dependent: "delivery/prod",
            prerequisite: "sjer-red/prod",
            rule: "any-accepted",
          },
        ],
      }),
    ).toMatch(/must form a DAG \(Z2\)/u);
    expect(
      issues({
        ...base,
        environments: base.environments.map((environment) =>
          environment.id === "arcade/prod"
            ? { ...environment, promotionSourceEnvironmentId: "delivery/prod" }
            : environment,
        ),
      }),
    ).toMatch(/must be another environment of arcade \(E6\)/u);
    expect(
      issues({
        ...base,
        environments: base.environments.map((environment) =>
          environment.id === "arcade/beta"
            ? { ...environment, promotionSourceEnvironmentId: "arcade/prod" }
            : environment,
        ),
      }),
    ).toMatch(/form a cycle/u);
  });
});

describe("catalogRevision", () => {
  test("is a sha256 over canonical JSON, stable under key order and sensitive to content", async () => {
    const base = await document();
    const parsed = CatalogDocumentSchema.parse(base);
    const revision = await catalogRevision(parsed);
    expect(revision).toMatch(/^sha256:[a-f0-9]{64}$/u);
    const reordered = CatalogDocumentSchema.parse({
      edges: [...base.edges].reverse().map((edge) => ({
        rule: edge.rule,
        prerequisite: edge.prerequisite,
        dependent: edge.dependent,
      })),
      configurations: base.configurations,
      recipes: base.recipes,
      environments: base.environments,
      services: base.services,
      groups: base.groups,
    });
    expect(await catalogRevision(reordered)).not.toBe(revision);
    const sameOrderDifferentKeys = CatalogDocumentSchema.parse({
      edges: base.edges.map((edge) => ({
        rule: edge.rule,
        prerequisite: edge.prerequisite,
        dependent: edge.dependent,
      })),
      configurations: base.configurations,
      recipes: base.recipes,
      environments: base.environments,
      services: base.services,
      groups: base.groups,
    });
    expect(await catalogRevision(sameOrderDifferentKeys)).toBe(revision);
    const changed = CatalogDocumentSchema.parse({
      ...base,
      configurations: base.configurations.map((configuration) =>
        configuration.id === "delivery/1"
          ? { ...configuration, content: { "postgres.major": "18" } }
          : configuration,
      ),
    });
    expect(await catalogRevision(changed)).not.toBe(revision);
  });

  test("canonical JSON sorts keys at every depth and drops undefined", () => {
    expect(canonicalJson({ b: [{ z: 1, a: undefined, m: 2 }], a: null })).toBe(
      '{"a":null,"b":[{"m":2,"z":1}]}',
    );
  });
});

describe("serviceLineage", () => {
  test("hashes the sorted component names so catalog order is presentational", async () => {
    const lineage = await serviceLineage(["image:arcade", "chart:arcade"]);
    expect(lineage).toBe(
      new Bun.CryptoHasher("sha256")
        .update("chart:arcade\nimage:arcade")
        .digest("hex"),
    );
    expect(await serviceLineage(["chart:arcade", "image:arcade"])).toBe(
      lineage,
    );
    expect(await serviceLineage(["chart:arcade"])).not.toBe(lineage);
  });
});
