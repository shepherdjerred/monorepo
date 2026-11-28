import { describe, expect, test } from "vitest";
import { z } from "zod";
import rawServices from "@shepherdjerred/ops-model/services.json" with { type: "json" };
import { parseCatalog } from "@shepherdjerred/ops-model/catalog.ts";
import { environmentService } from "@shepherdjerred/ops-model/catalog-document-shape.ts";
import { CATALOG_CORE, firstPartyOwner } from "./core.ts";
import { serviceCatalogView } from "./ops-view.ts";

/** First-party Docker Hub repositories (`@shepherdjerred/version-catalog`). */
const imageRegistry = z
  .object({
    images: z.array(
      z.object({ name: z.string(), visibility: z.string().optional() }),
    ),
  })
  .parse(
    await Bun.file(
      new URL(
        "../../../version-catalog/src/image-registry.json",
        import.meta.url,
      ),
    ).json(),
  );

const pendingImageNames = z
  .object({ pendingPrivateImages: z.record(z.string(), z.string()) })
  .transform(
    ({ pendingPrivateImages }) => new Set(Object.keys(pendingPrivateImages)),
  )
  .parse(
    await Bun.file(
      new URL(
        "../../../../scripts/checks/service-registration-exemptions.json",
        import.meta.url,
      ),
    ).json(),
  );

function componentsOf(serviceId: string): string[] | undefined {
  return CATALOG_CORE.services
    .find((service) => service.id === serviceId)
    ?.components.map((component) => component.name);
}

describe("catalog core", () => {
  test("the derived ops view equals services.json, so its consumers render the same bytes", () => {
    const { $schema: _schema, ...file } = parseCatalog(rawServices);
    expect(serviceCatalogView(CATALOG_CORE)).toStrictEqual(file);
  });

  test("self-hosted services, retired services and approval policy are the reviewed sets", () => {
    expect(
      CATALOG_CORE.services
        .filter((service) => service.selfHosted)
        .map((service) => service.id)
        .toSorted(),
    ).toEqual(["argocd", "delivery", "delivery-control-plane", "temporal"]);
    expect(
      CATALOG_CORE.services
        .filter((service) => service.lifecycle === "retired")
        .map((service) => service.id)
        .toSorted(),
    ).toEqual([]);
    expect(
      CATALOG_CORE.environments
        .filter((environment) => environment.approvalPolicy === "required")
        .map((environment) => environment.id)
        .toSorted(),
    ).toEqual(["scout-for-lol/prod", "starlight-karma-bot/prod"]);
  });

  test("registered images have a producing service unless held privately pending registration", () => {
    for (const name of pendingImageNames) {
      expect(
        imageRegistry.images.find((image) => image.name === name)?.visibility,
        name,
      ).toBe("private");
    }
    for (const { name } of imageRegistry.images) {
      const owner = firstPartyOwner(`image:${name}`);
      if (pendingImageNames.has(name)) expect(owner, name).toBeUndefined();
      else expect(owner, name).toBeDefined();
    }
  });

  test("ci holds only the runtime images CI and stage runners select; the public cross-compilers are their own services", () => {
    // Every component of `ci` must be filled by its first set (R0), and the
    // refresh producer fills them from committed pins. The cross-compiler
    // images have no pin or running producer (#3211), so they live in their
    // own services until their channel lanes return.
    expect(componentsOf("ci")).toEqual([
      "image:ci-base",
      "image:ci-playwright",
    ]);
    expect(componentsOf("macos-cross-compiler")).toEqual([
      "image:macos-cross-compiler",
    ]);
    expect(componentsOf("windows-cross-compiler")).toEqual([
      "image:windows-cross-compiler",
      "image:windows-cross-compiler-winui",
    ]);
    for (const serviceId of [
      "ci",
      "macos-cross-compiler",
      "windows-cross-compiler",
    ]) {
      expect(
        CATALOG_CORE.services.find((service) => service.id === serviceId)
          ?.group,
      ).toBe("ci");
      expect(
        CATALOG_CORE.environments.some(
          (environment) => environmentService(environment.id) === serviceId,
        ),
        serviceId,
      ).toBe(false);
    }
  });
});
