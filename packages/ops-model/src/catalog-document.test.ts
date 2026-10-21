import { describe, expect, test } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import documentSchema from "@shepherdjerred/ops-model/catalog-document.schema.json" with { type: "json" };
import { RevisionIdSchema } from "./catalog-document-shape.ts";
import {
  CatalogDocumentSchema,
  parseCatalogDocument,
} from "./catalog-document.ts";

const validateStructure = new Ajv2020({ strict: true }).compile(documentSchema);

type Json = Record<string, unknown>;

function fixture(): Json {
  return {
    $schema: "../catalog-document.schema.json",
    groups: [
      {
        id: "delivery",
        title: "Delivery",
        kind: "platform",
        package: "delivery",
      },
      { id: "temporal", title: "Temporal", kind: "platform" },
      {
        id: "delivery-control-plane",
        title: "Delivery control plane",
        kind: "platform",
      },
      {
        id: "scout-for-lol",
        title: "Scout for LoL",
        kind: "product",
        package: "scout-for-lol",
        aliases: ["scout"],
      },
      {
        id: "discord-plays-pokemon",
        title: "Discord plays Pokemon",
        kind: "product",
      },
    ],
    services: [
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
        ops: {
          kind: "platform",
          namespaces: ["delivery"],
          argoApps: ["delivery"],
          grafanaDashboards: ["delivery"],
        },
        legacy: {
          rootReleaseExclusions: { delivery: "inactive" },
          deploy: [],
        },
      },
      {
        id: "temporal",
        title: "Temporal",
        lifecycle: "active",
        selfHosted: true,
        group: "temporal",
        components: [
          { name: "image:temporal-worker", producer: "first-party" },
          { name: "chart:temporal", producer: "acquisition" },
        ],
      },
      {
        id: "delivery-control-plane",
        title: "Delivery control plane",
        lifecycle: "active",
        selfHosted: true,
        group: "delivery-control-plane",
        components: [
          { name: "chart:delivery-control-plane", producer: "first-party" },
          {
            name: "image:temporal-worker",
            producer: "reference",
            source: {
              service: "temporal",
              component: "image:temporal-worker",
              mode: "tracking",
              environment: "temporal/prod",
            },
          },
        ],
      },
      {
        id: "scout-for-lol",
        title: "Scout for LoL",
        package: "scout-for-lol",
        lifecycle: "active",
        selfHosted: false,
        group: "scout-for-lol",
        components: [
          { name: "image:scout-for-lol", producer: "first-party" },
          { name: "chart:scout-prod", producer: "first-party" },
          { name: "archive:scout-frontend", producer: "first-party" },
        ],
      },
      {
        id: "pokemon",
        title: "Discord plays Pokemon",
        lifecycle: "retired",
        selfHosted: false,
        group: "discord-plays-pokemon",
        components: [],
      },
    ],
    environments: [
      {
        id: "delivery/prod",
        role: "durable",
        lifecycle: "active",
        approvalPolicy: "required",
        automatic: true,
        recipeRevisionId: "delivery/1",
        configurationRevisionId: "delivery/1",
      },
      {
        id: "temporal/prod",
        role: "durable",
        approvalPolicy: "none",
        automatic: true,
        recipeRevisionId: "temporal/1",
        configurationRevisionId: "temporal/1",
      },
      {
        id: "delivery-control-plane/prod",
        role: "durable",
        approvalPolicy: "none",
        automatic: true,
        recipeRevisionId: "delivery-control-plane/1",
        configurationRevisionId: "delivery-control-plane/1",
      },
      {
        id: "scout-for-lol/beta",
        role: "durable",
        approvalPolicy: "none",
        automatic: true,
        recipeRevisionId: "scout-beta/2",
        configurationRevisionId: "scout-beta/1",
      },
      {
        id: "scout-for-lol/prod",
        role: "durable",
        approvalPolicy: "required",
        automatic: true,
        promotionSourceEnvironmentId: "scout-for-lol/beta",
        recipeRevisionId: "scout-prod/2",
        configurationRevisionId: "scout-prod/1",
      },
      {
        id: "scout-for-lol/mirror",
        role: "replica",
        approvalPolicy: "none",
        automatic: false,
        durableParent: "scout-for-lol/prod",
        recipeRevisionId: "scout-prod/2",
        configurationRevisionId: "scout-prod/1",
      },
    ],
    recipes: [
      { id: "delivery/1", definition: { kind: "kubernetes-application" } },
      { id: "temporal/1", definition: { kind: "kubernetes-application" } },
      {
        id: "delivery-control-plane/1",
        definition: { kind: "kubernetes-application" },
      },
      { id: "scout-beta/2", definition: { kind: "kubernetes-application" } },
      { id: "scout-prod/2", definition: { kind: "kubernetes-application" } },
    ],
    configurations: [
      { id: "delivery/1", content: {}, forwardOnly: [] },
      { id: "temporal/1", content: {}, forwardOnly: [] },
      { id: "delivery-control-plane/1", content: {}, forwardOnly: [] },
      { id: "scout-beta/1", content: {}, forwardOnly: [] },
      {
        id: "scout-prod/1",
        content: { "postgres.major": "17", replicas: "2" },
        forwardOnly: ["postgres.major"],
      },
    ],
    edges: [
      {
        dependent: "delivery-control-plane/prod",
        prerequisite: "temporal/prod",
        rule: "any-accepted",
      },
      {
        dependent: "delivery/prod",
        prerequisite: "temporal/prod",
        rule: "same-or-later-order-key",
      },
    ],
    legacy: {
      deliveryDelegations: { delivery: "delivery/prod" },
      platformDeliveryDelegated: true,
    },
  };
}

function section(document: Json, key: string): Json[] {
  const rows = document[key];
  if (!Array.isArray(rows)) {
    throw new TypeError(`fixture section ${key} is not an array`);
  }
  return rows.map((row: unknown) => {
    if (typeof row !== "object" || row === null) {
      throw new TypeError(`fixture row in ${key} is not an object`);
    }
    return { ...row };
  });
}

type InvalidCase = {
  name: string;
  /** Whether the language-neutral JSON Schema also rejects it (structural) or only the per-language refinements can (referential). */
  structural: boolean;
  message: RegExp;
  mutate: (document: Json) => Json;
};

const invalidCases: InvalidCase[] = [
  {
    name: "missing service id",
    structural: true,
    message: /services\.0\.id|Invalid input/u,
    mutate: (document) => {
      const [first, ...rest] = section(document, "services");
      if (first === undefined) {
        throw new Error("fixture has no services");
      }
      const { id: _id, ...withoutId } = first;
      return { ...document, services: [withoutId, ...rest] };
    },
  },
  {
    name: "component name without its type prefix",
    structural: true,
    message: /Invalid string/u,
    mutate: (document) => {
      const services = section(document, "services");
      services[0] = {
        ...services[0],
        components: [{ name: "delivery", producer: "first-party" }],
      };
      return { ...document, services };
    },
  },
  {
    name: "replica without a durable parent",
    structural: true,
    message: /replica names the durable environment/u,
    mutate: (document) => {
      const environments = section(document, "environments");
      const { durableParent: _parent, ...mirror } = environments[5] ?? {};
      environments[5] = mirror;
      return { ...document, environments };
    },
  },
  {
    name: "tracking reference without a source environment",
    structural: true,
    message: /tracking reference names the source environment/u,
    mutate: (document) => {
      const services = section(document, "services");
      services[2] = {
        ...services[2],
        components: [
          { name: "chart:delivery-control-plane", producer: "first-party" },
          {
            name: "image:temporal-worker",
            producer: "reference",
            source: {
              service: "temporal",
              component: "image:temporal-worker",
              mode: "tracking",
            },
          },
        ],
      };
      return { ...document, services };
    },
  },
  {
    name: "unknown recipe kind",
    structural: true,
    message: /Invalid option/u,
    mutate: (document) => {
      const recipes = section(document, "recipes");
      recipes[0] = { ...recipes[0], definition: { kind: "helm-release" } };
      return { ...document, recipes };
    },
  },
  {
    name: "a group that is not a service id",
    structural: true,
    message: /Invalid string/u,
    mutate: (document) => {
      const services = section(document, "services");
      services[0] = { ...services[0], group: "Observability stack" };
      return { ...document, services };
    },
  },
  {
    name: "a service naming an undeclared group",
    structural: false,
    message: /names undeclared group observability/u,
    mutate: (document) => {
      const services = section(document, "services");
      services[1] = { ...services[1], group: "observability" };
      return { ...document, services };
    },
  },
  {
    name: "a group alias that is a service id",
    structural: false,
    message: /Alias temporal of group scout-for-lol collides with service/u,
    mutate: (document) => {
      const groups = section(document, "groups");
      groups[3] = { ...groups[3], aliases: ["temporal"] };
      return { ...document, groups };
    },
  },
  {
    name: "a group sharing its id with a service of another group",
    structural: false,
    message: /shares its id with a service that belongs to group temporal/u,
    mutate: (document) => {
      const services = section(document, "services");
      services[0] = { ...services[0], group: "temporal" };
      return { ...document, services };
    },
  },
  {
    name: "an ops attribute the consumers do not read",
    structural: true,
    message: /Unrecognized key/u,
    mutate: (document) => {
      const services = section(document, "services");
      services[0] = {
        ...services[0],
        ops: { kind: "platform", images: ["delivery"] },
      };
      return { ...document, services };
    },
  },
  {
    name: "a content digest anywhere in the document",
    structural: false,
    message:
      /carries a content digest; versions of what runs belong to Delivery \(C2\)/u,
    mutate: (document) => {
      const configurations = section(document, "configurations");
      configurations[0] = {
        ...configurations[0],
        content: { runner: `docker.io/x/ci-base@sha256:${"a".repeat(64)}` },
      };
      return { ...document, configurations };
    },
  },
  {
    name: "a build-numbered chart version anywhere in the document",
    structural: false,
    message: /carries a build-numbered chart version/u,
    mutate: (document) => {
      const recipes = section(document, "recipes");
      recipes[0] = {
        ...recipes[0],
        definition: {
          kind: "kubernetes-application",
          targetRevision: "2.0.0-418",
        },
      };
      return { ...document, recipes };
    },
  },
  {
    name: "cyclic prerequisite edges",
    structural: false,
    message: /must form a DAG/u,
    mutate: (document) => ({
      ...document,
      edges: [
        ...section(document, "edges"),
        {
          dependent: "temporal/prod",
          prerequisite: "delivery/prod",
          rule: "any-accepted",
        },
      ],
    }),
  },
  {
    name: "promotion edge across services",
    structural: false,
    message: /must be another environment of scout-for-lol/u,
    mutate: (document) => {
      const environments = section(document, "environments");
      environments[4] = {
        ...environments[4],
        promotionSourceEnvironmentId: "temporal/prod",
      };
      return { ...document, environments };
    },
  },
  {
    name: "promotion edges forming a cycle",
    structural: false,
    message: /form a cycle/u,
    mutate: (document) => {
      const environments = section(document, "environments");
      environments[3] = {
        ...environments[3],
        promotionSourceEnvironmentId: "scout-for-lol/prod",
      };
      return { ...document, environments };
    },
  },
  {
    name: "reference to an unknown component",
    structural: false,
    message: /must name an existing image component of temporal/u,
    mutate: (document) => {
      const services = section(document, "services");
      services[2] = {
        ...services[2],
        components: [
          { name: "chart:delivery-control-plane", producer: "first-party" },
          {
            name: "image:temporal-worker",
            producer: "reference",
            source: {
              service: "temporal",
              component: "image:temporal-server",
              mode: "pinned",
            },
          },
        ],
      };
      return { ...document, services };
    },
  },
  {
    name: "reference to a component of another type",
    structural: false,
    message: /must name an existing image component of temporal/u,
    mutate: (document) => {
      const services = section(document, "services");
      services[2] = {
        ...services[2],
        components: [
          {
            name: "image:temporal-worker",
            producer: "reference",
            source: {
              service: "temporal",
              component: "chart:temporal",
              mode: "pinned",
            },
          },
        ],
      };
      return { ...document, services };
    },
  },
  {
    name: "forwardOnly key absent from the content",
    structural: false,
    message: /forwardOnly key postgres\.major is absent/u,
    mutate: (document) => {
      const configurations = section(document, "configurations");
      configurations[4] = {
        ...configurations[4],
        content: { replicas: "2" },
      };
      return { ...document, configurations };
    },
  },
  {
    name: "forwardOnly key with a non-numeric value",
    structural: false,
    message: /must hold a dotted numeric version/u,
    mutate: (document) => {
      const configurations = section(document, "configurations");
      configurations[4] = {
        ...configurations[4],
        content: { "postgres.major": "seventeen" },
      };
      return { ...document, configurations };
    },
  },
  {
    name: "environment naming an unknown recipe revision",
    structural: false,
    message: /unknown recipe revision scout-prod\/9/u,
    mutate: (document) => {
      const environments = section(document, "environments");
      environments[4] = {
        ...environments[4],
        recipeRevisionId: "scout-prod/9",
      };
      return { ...document, environments };
    },
  },
  {
    name: "duplicate component on one service",
    structural: false,
    message: /declared twice on delivery/u,
    mutate: (document) => {
      const services = section(document, "services");
      services[0] = {
        ...services[0],
        components: [
          { name: "image:delivery", producer: "first-party" },
          { name: "image:delivery", producer: "first-party" },
        ],
      };
      return { ...document, services };
    },
  },
  {
    name: "no self-hosted service",
    structural: false,
    message: /none is marked selfHosted/u,
    mutate: (document) => ({
      ...document,
      services: section(document, "services").map((service) => ({
        ...service,
        selfHosted: false,
      })),
    }),
  },
];

describe("catalog document", () => {
  test("the fixture satisfies the JSON Schema and the Zod mirror", () => {
    const document = fixture();
    expect(validateStructure(document)).toBe(true);
    expect(validateStructure.errors).toBeNull();
    const parsed = parseCatalogDocument(document);
    expect(parsed.services.map((service) => service.id)).toEqual([
      "delivery",
      "temporal",
      "delivery-control-plane",
      "scout-for-lol",
      "pokemon",
    ]);
    expect(
      parsed.environments.map((environment) => environment.lifecycle),
    ).toEqual(["active", "active", "active", "active", "active", "active"]);
    expect(parsed.services[0]?.ops).toEqual({
      kind: "platform",
      aliases: [],
      namespaces: ["delivery"],
      argoApps: ["delivery"],
      bugsinkProjects: [],
      analyticsSites: [],
      grafanaDashboards: ["delivery"],
    });
  });

  test.each(invalidCases)(
    "rejects $name",
    ({ structural, message, mutate }) => {
      const document = mutate(fixture());
      const result = CatalogDocumentSchema.safeParse(document);
      expect(result.success).toBe(false);
      expect(
        result.error?.issues.map((issue) => issue.message).join("\n"),
      ).toMatch(message);
      expect(validateStructure(document)).toBe(!structural);
    },
  );

  test("revision ids carry a numeric suffix", () => {
    for (const id of ["scout-prod/3", "static-sites/sjer-red/1"]) {
      expect(RevisionIdSchema.safeParse(id).success).toBe(true);
    }
    for (const id of ["scout-prod", "scout-prod/0", "scout-prod/v1"]) {
      expect(RevisionIdSchema.safeParse(id).success).toBe(false);
    }
  });
});
