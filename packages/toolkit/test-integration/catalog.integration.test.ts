import { test, expect, describe } from "vitest";
import { SERVICES, resolveServiceSelector } from "#lib/deployed/catalog.ts";
import { showCatalogAt } from "#lib/deployed/git.ts";
import { parseCatalogPins } from "#lib/deployed/catalog-pins.ts";
import {
  SERVICE_CATALOG,
  ServiceIndex,
} from "@shepherdjerred/ops-model/catalog.ts";
import { firstPartyImage } from "@shepherdjerred/version-catalog/image-registry";

/**
 * Recipe/ownership drift guard. Version keys identify repositories and variants;
 * selected first-party versions belong to Delivery, not the Git catalog.
 */
describe("deployed service registry", () => {
  test("registry variants have canonical image owners and no Git-selected version on HEAD", async () => {
    const text = await showCatalogAt("HEAD");
    if (text == null) {
      throw new Error("could not read the version catalog on HEAD");
    }
    const pins = parseCatalogPins(text);
    const owners = new ServiceIndex(SERVICE_CATALOG);
    for (const service of SERVICES) {
      for (const variant of service.variants) {
        const [namespace, image] = variant.versionKey.split("/");
        expect(namespace).toBe("shepherdjerred");
        if (image === undefined)
          throw new Error("Registry image recipe missing");
        expect(firstPartyImage(image).name).toBe(image);
        expect(owners.byImage(image)?.id).toBe(service.alias);
        expect(owners.byImage(image)?.argoApps).toContain(variant.argoApp);
        expect(pins.has(variant.versionKey)).toBe(false);
      }
    }
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
