import { describe, expect, test } from "vitest";
import {
  formatChecklist,
  loadRegistrationInputs,
  parseBakeTargets,
  parseSmokeCommands,
  recipeChartComponents,
  registrationFindings,
  type RegistrationInputs,
} from "./service-registration.ts";

/** One fully registered web service with an application image and a chart. */
function complete(): RegistrationInputs {
  return {
    services: [
      { id: "notes", package: "notes", images: ["notes"], charts: ["notes"] },
    ],
    environments: ["notes/prod"],
    deliveryDelegations: { notes: "notes/prod" },
    catalogEnvironmentOf: (environment) => environment,
    registryImages: new Set(["notes"]),
    applicationTargets: new Set(["notes"]),
    infrastructureTargets: new Set(),
    bakeTargets: new Map([
      [
        "notes",
        { dockerfile: "packages/notes/Dockerfile", hasSmokeStage: true },
      ],
    ]),
    smokeCommands: new Set(["notes"]),
    helmCharts: new Set(["notes"]),
    recipeEnvironments: new Set(["notes/prod"]),
    recipeCharts: new Set(["notes"]),
    policyDelegations: { notes: "notes/prod" },
    workspaces: new Set(["packages/notes"]),
    exemptions: {
      imagesBuiltOutsideBake: {},
      chartsWithoutRecipe: {},
      policyOnlyDelegations: {},
    },
  };
}

function items(inputs: RegistrationInputs): string[] {
  return registrationFindings(inputs).map(
    ({ subject, item }) => `${subject}: ${item}`,
  );
}

describe("registrationFindings", () => {
  test("a fully registered service has no findings", () => {
    expect(registrationFindings(complete())).toEqual([]);
  });

  test.each<[string, Partial<RegistrationInputs>, RegExp]>([
    [
      "image registry",
      { registryImages: new Set() },
      /^notes: image:notes: add it to packages\/version-catalog\/src\/image-registry\.json$/u,
    ],
    [
      "build target",
      { applicationTargets: new Set(), smokeCommands: new Set() },
      /^notes: image:notes: register it in ci\/scripts\/images\/image-targets\.ts/u,
    ],
    [
      "bake target",
      { bakeTargets: new Map() },
      /^notes: image:notes: add target "notes" to docker-bake\.hcl$/u,
    ],
    [
      "smoke stage",
      {
        bakeTargets: new Map([
          [
            "notes",
            { dockerfile: "packages/notes/Dockerfile", hasSmokeStage: false },
          ],
        ]),
      },
      /^notes: image:notes: add a `smoke` stage to packages\/notes\/Dockerfile$/u,
    ],
    [
      "in-image smoke command",
      { smokeCommands: new Set() },
      /^notes: image:notes: add an in-image smoke command to ci\/scripts\/images\/smoke-app-in-image\.ts$/u,
    ],
    [
      "Helm chart",
      { helmCharts: new Set() },
      /^notes: chart:notes: add packages\/homelab\/src\/cdk8s\/helm\/notes\/Chart\.yaml$/u,
    ],
    [
      "recipe deploying the chart",
      { recipeCharts: new Set() },
      /^notes: chart:notes: no recipe under packages\/delivery\/registrations\/v2 deploys it/u,
    ],
    [
      "environment recipe",
      { recipeEnvironments: new Set() },
      /^notes: environment notes\/prod: add packages\/delivery\/registrations\/v2\/notes\/prod\/recipe\.json/u,
    ],
    [
      "root workspace",
      { workspaces: new Set() },
      /^notes: package notes: add packages\/notes to the root package\.json workspaces$/u,
    ],
    [
      "Delivery policy entry",
      { policyDelegations: {} },
      /^catalog: delegation notes: add it to packages\/homelab\/src\/delivery-target-policy\.ts as notes\/prod$/u,
    ],
    [
      "catalog delegation",
      { deliveryDelegations: {} },
      /^catalog: delegation notes: add it to legacy\.deliveryDelegations in packages\/ops-model\/catalog-document\.json as notes\/prod$/u,
    ],
  ])("reports a missing %s", (_name, override, expected) => {
    const found = items({ ...complete(), ...override });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(expected);
  });

  test("reports a delegation the policy sends elsewhere", () => {
    expect(
      items({ ...complete(), policyDelegations: { notes: "notes/beta" } }),
    ).toEqual([
      "catalog: delegation notes: packages/ops-model/catalog-document.json says notes/prod but packages/homelab/src/delivery-target-policy.ts says notes/beta",
    ]);
  });

  test("resolves a pre-cutover delegation id before checking the catalog", () => {
    const renamed: RegistrationInputs = {
      ...complete(),
      deliveryDelegations: { notes: "apps/notes" },
      policyDelegations: { notes: "apps/notes" },
      catalogEnvironmentOf: (environment) =>
        environment === "apps/notes" ? "notes/prod" : environment,
    };
    expect(registrationFindings(renamed)).toEqual([]);
    expect(
      items({ ...renamed, catalogEnvironmentOf: (environment) => environment }),
    ).toEqual([
      "catalog: delegation notes: apps/notes is not a catalog environment",
    ]);
  });

  test("an infrastructure image needs no in-image smoke command", () => {
    expect(
      registrationFindings({
        ...complete(),
        applicationTargets: new Set(),
        infrastructureTargets: new Set(["notes"]),
        smokeCommands: new Set(),
      }),
    ).toEqual([]);
  });

  test("reports registered images no catalog service declares", () => {
    expect(
      items({
        ...complete(),
        registryImages: new Set(["notes", "stray"]),
        infrastructureTargets: new Set(["orphan"]),
      }),
    ).toEqual([
      "catalog: image stray is in packages/version-catalog/src/image-registry.json but no catalog service has a first-party image:stray component",
      "catalog: image orphan is a build target in ci/scripts/images/image-targets.ts but no catalog service has a first-party image:orphan component",
    ]);
  });

  describe("exemptions", () => {
    test("an image built outside the bake needs only the registry", () => {
      const inputs: RegistrationInputs = {
        ...complete(),
        applicationTargets: new Set(),
        bakeTargets: new Map(),
        smokeCommands: new Set(),
        exemptions: {
          ...complete().exemptions,
          imagesBuiltOutsideBake: { notes: "built elsewhere" },
        },
      };
      expect(registrationFindings(inputs)).toEqual([]);
      expect(items({ ...inputs, registryImages: new Set() })).toEqual([
        "notes: image:notes: add it to packages/version-catalog/src/image-registry.json",
      ]);
    });

    test("a chart without a recipe and a policy-only delegation pass when listed", () => {
      expect(
        registrationFindings({
          ...complete(),
          recipeCharts: new Set(),
          deliveryDelegations: {},
          exemptions: {
            imagesBuiltOutsideBake: {},
            chartsWithoutRecipe: { notes: "inactive" },
            policyOnlyDelegations: { notes: "inactive" },
          },
        }),
      ).toEqual([]);
    });

    test("every stale exemption fails", () => {
      expect(
        items({
          ...complete(),
          exemptions: {
            imagesBuiltOutsideBake: { notes: "x", gone: "x" },
            chartsWithoutRecipe: { notes: "x", gone: "x" },
            policyOnlyDelegations: { notes: "x", gone: "x" },
          },
        }),
      ).toEqual([
        'exemptions: IMAGES_BUILT_OUTSIDE_BAKE["notes"]: it has a bake target now; delete the exemption',
        'exemptions: IMAGES_BUILT_OUTSIDE_BAKE["gone"]: not a first-party catalog image; delete the exemption',
        'exemptions: CHARTS_WITHOUT_RECIPE["notes"]: a recipe deploys it now; delete the exemption',
        'exemptions: CHARTS_WITHOUT_RECIPE["gone"]: not a first-party catalog chart; delete the exemption',
        'exemptions: POLICY_ONLY_DELEGATIONS["notes"]: the catalog delegates it now; delete the exemption',
        'exemptions: POLICY_ONLY_DELEGATIONS["gone"]: the Delivery policy no longer names it; delete the exemption',
      ]);
    });
  });
});

describe("formatChecklist", () => {
  test("groups items under their subject as unchecked boxes", () => {
    expect(
      formatChecklist([
        { subject: "notes", item: "first" },
        { subject: "catalog", item: "second" },
        { subject: "notes", item: "third" },
      ]),
    ).toBe("notes\n  [ ] first\n  [ ] third\n\ncatalog\n  [ ] second");
  });
});

describe("parseBakeTargets", () => {
  const bake = [
    'target "_app" {',
    '  context = "."',
    "}",
    "",
    'target "notes" {',
    '  inherits   = ["_app"]',
    '  dockerfile = "packages/notes/Dockerfile"',
    "}",
    "",
    'target "driver" {',
    '  context = "packages/homelab/images/driver"',
    "}",
    "",
    'target "server" {',
    '  context    = "packages/storm"',
    "  contexts = {",
    '    flags = "packages/flags/src"',
    "  }",
    '  dockerfile = "server/Dockerfile"',
    "}",
    "",
  ].join("\n");

  test("resolves each target's Dockerfile and skips templates", () => {
    expect(Object.fromEntries(parseBakeTargets(bake))).toEqual({
      notes: { dockerfile: "packages/notes/Dockerfile" },
      driver: { dockerfile: "packages/homelab/images/driver/Dockerfile" },
      server: { dockerfile: "packages/storm/server/Dockerfile" },
    });
  });
});

describe("parseSmokeCommands", () => {
  test("reads the keys of the commands table only", () => {
    const source = [
      "const other = {",
      "  ignored: {",
      "  },",
      "};",
      "const commands: Record<string, Command> = {",
      "  delivery: {",
      "    env: {",
      "    },",
      "  },",
      '  "alert-dashboard": {',
      "  },",
      "};",
      "const after = {",
      "  alsoIgnored: {",
      "  },",
      "};",
    ].join("\n");
    expect([...parseSmokeCommands(source)]).toEqual([
      "delivery",
      "alert-dashboard",
    ]);
  });
});

describe("recipeChartComponents", () => {
  test("finds the chart of a plain and of a compound recipe", () => {
    expect(
      recipeChartComponents({
        definition: {
          kind: "kubernetes-application",
          chartComponent: "chart:a",
        },
      }),
    ).toEqual(["chart:a"]);
    expect(
      recipeChartComponents({
        definition: {
          kind: "compound",
          subRecipes: [
            { definition: { chartComponent: "chart:b" } },
            { definition: { chartComponent: "chart:c" } },
          ],
        },
      }),
    ).toEqual(["chart:b", "chart:c"]);
  });
});

describe("this repository", () => {
  test("every catalog service is completely registered", async () => {
    const inputs = await loadRegistrationInputs();
    // Guard against a loader that silently reads nothing.
    expect(inputs.services.length).toBeGreaterThan(40);
    expect(inputs.bakeTargets.size).toBeGreaterThan(15);
    expect(inputs.smokeCommands.size).toBeGreaterThan(10);
    expect(inputs.recipeCharts.size).toBeGreaterThan(50);
    expect(formatChecklist(registrationFindings(inputs))).toBe("");
  });
});
