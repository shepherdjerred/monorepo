import { describe, expect, test } from "vitest";
import { z } from "zod";
import rawServices from "@shepherdjerred/ops-model/services.json" with { type: "json" };
import { parseCatalog } from "@shepherdjerred/ops-model/catalog.ts";
import { CATALOG_CORE, firstPartyOwner } from "./core.ts";
import { serviceCatalogView } from "./ops-view.ts";

/** First-party Docker Hub repositories (`@shepherdjerred/version-catalog`). */
const imageRegistry = z
  .object({ images: z.array(z.object({ name: z.string() })) })
  .parse(
    await Bun.file(
      new URL(
        "../../../version-catalog/src/image-registry.json",
        import.meta.url,
      ),
    ).json(),
  );

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
    ).toEqual(["discord-plays-mario-kart", "discord-plays-pokemon"]);
    expect(
      CATALOG_CORE.environments
        .filter((environment) => environment.approvalPolicy === "required")
        .map((environment) => environment.id)
        .toSorted(),
    ).toEqual(["scout-for-lol/prod", "starlight-karma-bot/prod"]);
  });

  test("every first-party image has exactly one producing service", () => {
    for (const image of imageRegistry.images)
      expect(firstPartyOwner(`image:${image.name}`), image.name).toBeDefined();
  });
});
