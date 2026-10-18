import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  parseCatalog,
  SERVICE_CATALOG,
  ServiceIndex,
} from "@shepherdjerred/ops-model/catalog.ts";

async function analyticsSiteKeys(): Promise<Set<string>> {
  const analyticsRegistry: unknown = await Bun.file(
    new URL("../../../config/analytics-sites.json", import.meta.url),
  ).json();
  if (
    typeof analyticsRegistry !== "object" ||
    analyticsRegistry === null ||
    !("sites" in analyticsRegistry) ||
    !Array.isArray(analyticsRegistry.sites)
  ) {
    throw new TypeError("analytics-sites.json has no sites array");
  }
  return new Set(
    analyticsRegistry.sites.map((site: unknown) => {
      if (typeof site !== "object" || site === null || !("key" in site)) {
        throw new TypeError("analytics site without key");
      }
      return String(site.key);
    }),
  );
}

test("separate CP chart ownership does not alias its original Temporal image producer", () => {
  const index = new ServiceIndex();
  expect(index.byChart("delivery-control-plane")?.id).toBe(
    "delivery-control-plane",
  );
  expect(index.byImage("temporal-worker")?.id).toBe("temporal");
  expect(index.requireById("delivery-control-plane").bootstrapImages).toEqual([
    "temporal-worker",
  ]);
  expect(() =>
    parseCatalog({
      ...SERVICE_CATALOG,
      services: SERVICE_CATALOG.services.map((service) =>
        service.id === "delivery-control-plane"
          ? { ...service, bootstrapImages: ["unowned-image"] }
          : service,
      ),
    }),
  ).toThrow("requires its canonical image owner");
});

describe("service catalog", () => {
  test.each(["unknown", "apps", "argocd", "delivery"])(
    "rejects a delegation to %s",
    (application) => {
      expect(() =>
        parseCatalog({
          services: [
            {
              id: "platform",
              title: "Platform",
              kind: "platform",
              namespaces: [],
              argoApps: ["apps", "argocd", "delivery"],
            },
          ],
          deliveryDelegations: { [application]: "service/prod" },
        }),
      ).toThrow(/registered non-control-plane Application/);
    },
  );

  test("rejects two Applications delegated to the same environment", () => {
    expect(() =>
      parseCatalog({
        services: [
          {
            id: "service",
            title: "Service",
            kind: "workload",
            namespaces: [],
            argoApps: ["service-a", "service-b"],
          },
        ],
        deliveryDelegations: {
          "service-a": "service/prod",
          "service-b": "service/prod",
        },
      }),
    ).toThrow(/cannot own two Applications/);
  });

  test("parses the committed catalog", () => {
    expect(SERVICE_CATALOG.services.length).toBeGreaterThan(10);
  });

  test("every registered first-party image has exactly one service owner", async () => {
    const registry = z
      .object({ images: z.array(z.object({ name: z.string() })) })
      .parse(
        await Bun.file(
          new URL(
            "../../version-catalog/src/image-registry.json",
            import.meta.url,
          ),
        ).json(),
      );
    const index = new ServiceIndex();
    const registered = registry.images.map((image) => image.name).sort();
    expect(
      SERVICE_CATALOG.services.flatMap((service) => service.images).sort(),
    ).toEqual(registered);
    for (const image of registered) expect(index.byImage(image)).toBeDefined();
    expect(index.byImage("unknown-image")).toBeUndefined();
  });

  test("rejects competing image publishers", () => {
    expect(() =>
      parseCatalog({
        services: ["a", "b"].map((id) => ({
          id,
          title: id,
          kind: "platform",
          namespaces: [],
          argoApps: [],
          images: ["shared-image"],
        })),
      }),
    ).toThrow(/image shared-image belongs to both/);
  });

  test("every packaged chart has an owner without claiming dormant Applications are active", async () => {
    const index = new ServiceIndex();
    const cwd = new URL("../../homelab/src/cdk8s/helm/", import.meta.url)
      .pathname;
    for await (const file of new Bun.Glob("*/Chart.yaml").scan({ cwd })) {
      const chart = file.split("/")[0];
      if (chart === undefined)
        throw new Error("Chart fixture path has no name");
      expect(index.byChart(chart), chart).toBeDefined();
    }
    expect(index.byChart("delivery")?.id).toBe("delivery");
    expect(index.byArgoApp("delivery")?.id).toBe("delivery");
    expect(index.byChart("unknown-chart")).toBeUndefined();
  });

  test("rejects chart ownership that conflicts with an existing Application owner", () => {
    expect(() =>
      parseCatalog({
        services: [
          {
            id: "a",
            title: "A",
            kind: "platform",
            namespaces: [],
            argoApps: ["shared-chart"],
          },
          {
            id: "b",
            title: "B",
            kind: "platform",
            namespaces: [],
            argoApps: [],
            charts: ["shared-chart"],
          },
        ],
      }),
    ).toThrow(/chart shared-chart belongs to both/);
  });

  test("every analytics site belongs to exactly one service", async () => {
    const keys = await analyticsSiteKeys();
    const claimed = SERVICE_CATALOG.services.flatMap((s) => s.analyticsSites);
    expect(claimed.filter((key) => !keys.has(key))).toEqual([]);
    expect([...keys].filter((key) => !claimed.includes(key))).toEqual([]);
  });

  test("deploy variants point at the service's own Argo apps or the umbrella", () => {
    for (const service of SERVICE_CATALOG.services) {
      for (const variant of service.deploy) {
        expect(
          service.argoApps.includes(variant.argoApp) ||
            variant.argoApp === "apps",
        ).toBe(true);
      }
    }
  });

  test("rejects a namespace claimed by two services", () => {
    expect(() =>
      parseCatalog({
        services: [
          {
            id: "a",
            title: "A",
            kind: "product",
            namespaces: ["x"],
            argoApps: [],
          },
          {
            id: "b",
            title: "B",
            kind: "product",
            namespaces: ["x"],
            argoApps: [],
          },
        ],
      }),
    ).toThrow(/namespace x belongs to both a and b/);
  });

  test("rejects an alias that collides with another id", () => {
    expect(() =>
      parseCatalog({
        services: [
          {
            id: "a",
            title: "A",
            kind: "product",
            namespaces: [],
            argoApps: [],
          },
          {
            id: "b",
            title: "B",
            kind: "product",
            aliases: ["a"],
            namespaces: [],
            argoApps: [],
          },
        ],
      }),
    ).toThrow(/alias a belongs to both/);
  });
});

describe("ServiceIndex", () => {
  const index = new ServiceIndex();

  test("joins every upstream name to one service", () => {
    expect(index.byNamespace("scout-prod")?.id).toBe("scout-for-lol");
    expect(index.byArgoApp("pokemon")?.id).toBe("discord-plays-pokemon");
    expect(index.byBugsinkProject("tasknotes-api")?.id).toBe(
      "tasknotes-server",
    );
    expect(index.byAnalyticsSite("resume")?.id).toBe("static-sites");
    expect(index.byId("Scout")?.id).toBe("scout-for-lol");
    expect(index.byImage("obsidian-headless")?.id).toBe("tasknotes-server");
    expect(index.byId("obsidian-headless")?.images).toEqual([]);
    expect(index.byId("obsidian-headless")?.deploy).toEqual([]);
  });

  test("owns the prepared launcher inventory without a deployable image", () => {
    const launcher = index.requireById("glitter-boys-launcher");
    expect(index.byNamespace("glitter-boys-launcher")).toBe(launcher);
    expect(index.byArgoApp("glitter-boys-launcher")).toBeUndefined();
    expect(launcher.argoApps).toEqual([]);
    expect(launcher.deploy).toEqual([]);
  });

  test("unknown names resolve to undefined, and require throws", () => {
    expect(index.byNamespace("nope")).toBeUndefined();
    expect(() => index.requireById("nope")).toThrow(/Unknown service/);
  });
});
