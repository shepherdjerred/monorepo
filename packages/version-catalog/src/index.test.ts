import { describe, expect, test } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import rawCatalog from "./catalog.json" with { type: "json" };
import catalogSchema from "./schema.json" with { type: "json" };
import {
  VersionCatalogEntrySchema,
  catalogComponentName,
  componentEntries,
  githubSource,
  ociChart,
  parseVersionCatalog,
  parseVersionCatalogText,
  serializeVersionCatalog,
  upstreamName,
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

describe("Delivery component naming", () => {
  const digest = `sha256:${"a".repeat(64)}`;
  const image = (name: string, packageName?: string) =>
    VersionCatalogEntrySchema.parse({
      name,
      category: "upstream",
      artifactType: "image",
      management: {
        managed: true,
        datasource: "docker",
        registryUrl: "https://docker.io",
        versioning: "docker",
        ...(packageName === undefined ? {} : { packageName }),
      },
      value: `1.0.0@${digest}`,
      component: true,
    });

  test("names a chart by its name and an image by its repository basename", () => {
    const [chart] = componentEntries(parseVersionCatalog(rawCatalog));
    if (chart === undefined) throw new Error("The catalog has no component");
    expect(catalogComponentName(chart)).toBe(`chart:${chart.name}`);
    expect(catalogComponentName(image("busybox"))).toBe("image:busybox");
    expect(catalogComponentName(image("grafana/grafana-image-renderer"))).toBe(
      "image:grafana-image-renderer",
    );
  });

  test("an alias keeps its own component name but is pulled from its packageName", () => {
    const alias = image("itzg/minecraft-server-java8", "itzg/minecraft-server");
    expect(catalogComponentName(alias)).toBe("image:minecraft-server-java8");
    expect(upstreamName(alias)).toBe("itzg/minecraft-server");
    expect(upstreamName(image("itzg/minecraft-server"))).toBe(
      "itzg/minecraft-server",
    );
  });

  test("every committed component entry has a distinct component name", () => {
    const names = componentEntries(parseVersionCatalog(rawCatalog)).map(
      (entry) => catalogComponentName(entry),
    );
    expect(new Set(names).size).toBe(names.length);
  });

  test("a GitHub source is an archive of its tagged commit, named by its repository", () => {
    const source = {
      name: "adyanth/cloudflare-operator",
      category: "upstream",
      artifactType: "source",
      management: {
        managed: true,
        datasource: "github-releases",
        versioning: "semver",
      },
      value: "v0.13.1",
      component: true,
    };
    const entry = VersionCatalogEntrySchema.parse(source);
    expect(githubSource(entry)).toBe(true);
    expect(catalogComponentName(entry)).toBe("archive:cloudflare-operator");
    // A source Delivery cannot fetch from GitHub is no component.
    expect(() =>
      VersionCatalogEntrySchema.parse({
        ...source,
        management: { managed: false },
      }),
    ).toThrow("GitHub sources pinned by tag");
    expect(() =>
      VersionCatalogEntrySchema.parse({
        ...source,
        management: { ...source.management, datasource: "custom.papermc" },
      }),
    ).toThrow("GitHub sources pinned by tag");
  });

  test("an OCI chart is a digest-pinned chart named by its catalog name", () => {
    const kueue = {
      name: "kueue",
      category: "upstream",
      artifactType: "helm-chart",
      management: {
        managed: true,
        datasource: "docker",
        registryUrl: "https://registry.k8s.io",
        versioning: "semver",
        packageName: "kueue/charts/kueue",
      },
      value: `0.20.1@${digest}`,
      component: true,
    };
    const entry = VersionCatalogEntrySchema.parse(kueue);
    expect(ociChart(entry)).toBe(true);
    expect(catalogComponentName(entry)).toBe("chart:kueue");
    expect(upstreamName(entry)).toBe("kueue/charts/kueue");
    expect(() =>
      VersionCatalogEntrySchema.parse({ ...kueue, value: "0.20.1" }),
    ).toThrow("digest-pinned");
  });
});
