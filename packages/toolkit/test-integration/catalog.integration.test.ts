import { test, expect, describe } from "vitest";
import { SERVICES, resolveServiceSelector } from "#lib/deployed/catalog.ts";
import { showCatalogAt } from "#lib/deployed/git.ts";
import { parseCatalogPins } from "#lib/deployed/catalog-pins.ts";

/**
 * Drift guard: every versionKey in the service registry must exist in the real
 * version catalog on HEAD. This catches typos and renamed pins without importing
 * across the package boundary (banned by no-parent-imports). The catalog is the
 * source of truth the command reads live, so validating against it is stronger
 * than checking scripts/ci/src/catalog.ts.
 */
describe("deployed service registry", () => {
  test("every registry versionKey exists in the version catalog on HEAD", async () => {
    const text = await showCatalogAt("HEAD");
    if (text == null) {
      throw new Error("could not read the version catalog on HEAD");
    }
    const pins = parseCatalogPins(text);
    const missing: string[] = [];
    for (const service of SERVICES) {
      for (const variant of service.variants) {
        if (!pins.has(variant.versionKey)) {
          missing.push(variant.versionKey);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  test("service aliases and variant keys are unique", () => {
    const aliases = SERVICES.map((s) => s.alias);
    expect(new Set(aliases).size).toBe(aliases.length);

    const keys = SERVICES.flatMap((s) => s.variants.map((v) => v.versionKey));
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("selector resolution: service, variant, hyphen, and alias forms", () => {
    expect(resolveServiceSelector("scout")?.service.alias).toBe(
      "scout-for-lol",
    );
    expect(resolveServiceSelector("scout")?.variant).toBeNull();

    const prod = resolveServiceSelector("scout/prod");
    expect(prod?.variant?.name).toBe("prod");
    expect(prod?.variant?.argoApp).toBe("scout-prod");

    expect(resolveServiceSelector("scout-beta")?.variant?.name).toBe("beta");
    expect(resolveServiceSelector("birmel")?.service.alias).toBe("birmel");
    expect(resolveServiceSelector("not-a-service")).toBeNull();
  });
});
