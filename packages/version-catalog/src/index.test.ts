import { describe, expect, test } from "bun:test";
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
    expect(validate(rawCatalog)).toBeTrue();
    expect(validate.errors).toBeNull();
  });

  test("parses and maps the language-neutral catalog", () => {
    const catalog = parseVersionCatalog(rawCatalog);
    const map = versionCatalogMap(catalog);
    expect(catalog.entries.length).toBeGreaterThan(100);
    expect(Object.keys(map)).toHaveLength(catalog.entries.length);
  });

  test("serializes a canonical round trip", () => {
    const catalog = parseVersionCatalog(rawCatalog);
    const serialized = serializeVersionCatalog(catalog);
    expect(parseVersionCatalogText(serialized)).toEqual(catalog);
    expect(serialized.endsWith("\n")).toBeTrue();
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
});
