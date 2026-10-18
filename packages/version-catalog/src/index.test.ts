import { describe, expect, test } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import rawCatalog from "./catalog.json" with { type: "json" };
import catalogSchema from "./schema.json" with { type: "json" };
import {
  parseVersionCatalog,
  parseVersionCatalogText,
  serializeVersionCatalog,
  versionCatalogMap,
} from "./index.ts";

describe("version catalog", () => {
  test("conforms to the published language-neutral JSON Schema", () => {
    const validate = new Ajv2020({
      strict: true,
      validateFormats: false,
    }).compile(catalogSchema);
    expect(validate(rawCatalog)).toBe(true);
    expect(validate.errors).toBeNull();
  });

  test("parses and maps the language-neutral catalog", () => {
    const catalog = parseVersionCatalog(rawCatalog);
    const map = versionCatalogMap(catalog);
    expect(catalog.entries.length).toBeGreaterThan(100);
    expect(Object.keys(map)).toHaveLength(catalog.entries.length);
    expect(new Set(catalog.entries.map((entry) => entry.category))).toEqual(
      new Set(["upstream"]),
    );
  });

  test("serializes a canonical round trip", () => {
    const catalog = parseVersionCatalog(rawCatalog);
    const serialized = serializeVersionCatalog(catalog);
    expect(parseVersionCatalogText(serialized)).toEqual(catalog);
    expect(serialized.endsWith("\n")).toBe(true);
  });

  test("rejects duplicate names", () => {
    const catalog = parseVersionCatalog(rawCatalog);
    const duplicate = {
      ...catalog,
      entries: [catalog.entries[0], catalog.entries[0]],
    };
    expect(() => parseVersionCatalog(duplicate)).toThrow(
      "version catalog names must be unique",
    );
  });

  test.each(["ci", "local"])(
    "round trips the %s image publisher",
    (imagePublisher) => {
      const imageEntry = {
        name: "historical/example",
        category: "internal-image",
        artifactType: "image",
        management: { managed: false },
        value: `1.0.0-1@sha256:${"a".repeat(64)}`,
      };
      const catalog = {
        ...rawCatalog,
        entries: [{ ...imageEntry, imagePublisher }],
      };
      const validate = new Ajv2020({
        strict: true,
        validateFormats: false,
      }).compile(catalogSchema);
      expect(validate(catalog)).toBe(true);
      expect(
        parseVersionCatalogText(
          serializeVersionCatalog(parseVersionCatalog(catalog)),
        ),
      ).toEqual(catalog);
    },
  );

  test.each([
    { category: "upstream", artifactType: "image", imagePublisher: "local" },
    {
      category: "internal-image",
      artifactType: "package",
      imagePublisher: "ci",
    },
    {
      category: "internal-image",
      artifactType: "image",
      imagePublisher: "unknown",
    },
  ])("both schemas reject an invalid publisher declaration: %j", (fields) => {
    const catalog = {
      ...rawCatalog,
      entries: [{ ...rawCatalog.entries[0], ...fields }],
    };
    const validate = new Ajv2020({
      strict: true,
      validateFormats: false,
    }).compile(catalogSchema);
    expect(validate(catalog)).toBe(false);
    expect(() => parseVersionCatalog(catalog)).toThrow();
  });
});
