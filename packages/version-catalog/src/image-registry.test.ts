import { describe, expect, test } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import rawRegistry from "./image-registry.json" with { type: "json" };
import registrySchema from "./image-registry.schema.json" with { type: "json" };
import {
  firstPartyImage,
  firstPartyImageRepository,
  imageRegistry,
  ImageRegistrySchema,
} from "./image-registry.ts";
import rawCatalog from "./catalog.json" with { type: "json" };
import { parseVersionCatalog } from "./index.ts";

describe("first-party image registry", () => {
  test("conforms to the language-neutral schema used by infrastructure", () => {
    const validate = new Ajv2020({ strict: true }).compile(registrySchema);
    expect(validate(rawRegistry)).toBe(true);
    expect(validate.errors).toBeNull();
  });

  test("keeps exactly the public compiler products anonymous", () => {
    expect(
      imageRegistry.images
        .filter((image) => image.visibility === "public")
        .map((image) => image.name)
        .toSorted(),
    ).toEqual([
      "macos-cross-compiler",
      "windows-cross-compiler",
      "windows-cross-compiler-winui",
    ]);
    expect(firstPartyImage("ci-base").visibility).toBe("private");
  });

  test("covers every internal image pin, including release variants", () => {
    for (const entry of parseVersionCatalog(rawCatalog).entries) {
      if (entry.category !== "internal-image") continue;
      const name = entry.name.split("/")[1];
      if (name === undefined)
        throw new Error(`Invalid image pin ${entry.name}`);
      expect(firstPartyImageRepository(name)).toBe(
        `docker.io/shepherdjerred/${name}`,
      );
    }
  });

  test("rejects unknown names instead of publishing with implicit visibility", () => {
    expect(() => firstPartyImageRepository("unknown-service")).toThrow(
      "Unregistered first-party image",
    );
  });

  test("rejects duplicate names and unexpected registry metadata", () => {
    expect(() =>
      ImageRegistrySchema.parse({
        ...imageRegistry,
        images: [...imageRegistry.images, imageRegistry.images[0]],
      }),
    ).toThrow("image repository names must be unique");
    expect(() =>
      ImageRegistrySchema.parse({ ...imageRegistry, registry: "ghcr.io" }),
    ).toThrow();
    expect(() =>
      ImageRegistrySchema.parse({
        ...imageRegistry,
        images: [{ name: "a/b", visibility: "private" }],
      }),
    ).toThrow();
  });
});
