import { expect, test } from "vitest";
import {
  componentEntries,
  parseVersionCatalog,
} from "@shepherdjerred/version-catalog";
import rawCatalog from "@shepherdjerred/version-catalog/catalog.json";
import { publishSourceComponents } from "./upstream-source-publication.ts";
import { parseDeliveryCatalogRegistry } from "./image-publication-handoff.ts";

test("the producer rejects missing or malformed registry selections", () => {
  expect(parseDeliveryCatalogRegistry('"v1"')).toBe("v1");
  expect(parseDeliveryCatalogRegistry('"v2"')).toBe("v2");
  for (const raw of ["", "null", '"v3"', "{}"])
    expect(() => parseDeliveryCatalogRegistry(raw)).toThrow();
});

test("the shared archive producer acquires source components only after the catalog flip", async () => {
  const catalog = parseVersionCatalog(rawCatalog);
  let calls = 0;
  const acquire = async (selected: typeof catalog) => {
    calls += 1;
    expect(
      componentEntries(selected).map((entry) => [
        entry.artifactType,
        entry.name,
      ]),
    ).toEqual([["source", "adyanth/cloudflare-operator"]]);
    return [];
  };
  expect(await publishSourceComponents("v1", catalog, acquire)).toEqual([]);
  expect(calls).toBe(0);
  expect(await publishSourceComponents("v2", catalog, acquire)).toEqual([]);
  expect(calls).toBe(1);
});
