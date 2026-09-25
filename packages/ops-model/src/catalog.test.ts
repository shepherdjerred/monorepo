import { describe, expect, test } from "vitest";
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

describe("service catalog", () => {
  test("parses the committed catalog", () => {
    expect(SERVICE_CATALOG.services.length).toBeGreaterThan(10);
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
  });

  test("unknown names resolve to undefined, and require throws", () => {
    expect(index.byNamespace("nope")).toBeUndefined();
    expect(() => index.requireById("nope")).toThrow(/Unknown service/);
  });
});
