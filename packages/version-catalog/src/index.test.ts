import { describe, expect, test } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import rawCatalog from "./catalog.json" with { type: "json" };
import catalogSchema from "./schema.json" with { type: "json" };
import {
  VersionCatalogEntrySchema,
  catalogComponentName,
  componentEntries,
  findMutatedComponentTagDigests,
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
    expect(catalog.entries.length).toBeGreaterThan(90);
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

const SAMPLE_DIGEST = `sha256:${"a".repeat(64)}`;
function sampleComponentImage(name: string, packageName?: string) {
  return VersionCatalogEntrySchema.parse({
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
    value: `1.0.0@${SAMPLE_DIGEST}`,
    component: true,
  });
}

describe("Delivery component naming", () => {
  const digest = SAMPLE_DIGEST;
  const image = sampleComponentImage;

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

  test("every committed component image pins a release tag, never a moving one", () => {
    // Delivery keys an upstream artifact by its tag and refuses a second
    // digest for the same tag, so a moving tag stops publication at its
    // first digest refresh.
    const moving = componentEntries(parseVersionCatalog(rawCatalog))
      .filter((entry) => entry.artifactType === "image")
      .filter((entry) => {
        const [tag = ""] = entry.value.split("@");
        return (
          !/\d/u.test(tag) || /^(?:latest|stable|edge|main|master)$/u.test(tag)
        );
      })
      .map((entry) => entry.name);
    expect(moving).toEqual([]);
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

describe("immutable component tag digests (AI-738)", () => {
  const digest = SAMPLE_DIGEST;
  const otherDigest = `sha256:${"b".repeat(64)}`;
  const componentImage = sampleComponentImage;

  test("findMutatedComponentTagDigests rejects changing the digest of an unchanged component tag", () => {
    const base = parseVersionCatalog({
      $schema: "./schema.json",
      schemaVersion: 1,
      entries: [
        componentImage("mikefarah/yq"),
        componentImage("itzg/minecraft-server-java8", "itzg/minecraft-server"),
        VersionCatalogEntrySchema.parse({
          name: "non-component/image",
          category: "upstream",
          artifactType: "image",
          management: {
            managed: true,
            datasource: "docker",
            registryUrl: "https://docker.io",
            versioning: "docker",
          },
          value: `1.0.0@${digest}`,
        }),
      ],
    });
    expect(findMutatedComponentTagDigests(base, base)).toEqual([]);
    const bumpedTag = parseVersionCatalog({
      ...base,
      entries: base.entries.map((entry) =>
        entry.name === "mikefarah/yq"
          ? { ...entry, value: `1.0.1@${otherDigest}` }
          : entry,
      ),
    });
    expect(findMutatedComponentTagDigests(base, bumpedTag)).toEqual([]);
    const nonComponentRefresh = parseVersionCatalog({
      ...base,
      entries: base.entries.map((entry) =>
        entry.name === "non-component/image"
          ? { ...entry, value: `1.0.0@${otherDigest}` }
          : entry,
      ),
    });
    expect(findMutatedComponentTagDigests(base, nonComponentRefresh)).toEqual(
      [],
    );
    const mutated = parseVersionCatalog({
      ...base,
      entries: base.entries.map((entry) =>
        entry.name === "mikefarah/yq" ||
        entry.name === "itzg/minecraft-server-java8"
          ? { ...entry, value: `1.0.0@${otherDigest}` }
          : entry,
      ),
    });
    expect(findMutatedComponentTagDigests(base, mutated)).toEqual([
      {
        name: "mikefarah/yq",
        upstream: "mikefarah/yq",
        tag: "1.0.0",
        baseDigest: digest,
        headDigest: otherDigest,
      },
      {
        name: "itzg/minecraft-server-java8",
        upstream: "itzg/minecraft-server",
        tag: "1.0.0",
        baseDigest: digest,
        headDigest: otherDigest,
      },
    ]);
  });

  test("no committed component entry mutates the digest of an already-registered tag on origin/main", () => {
    const changedBase = Bun.env["CI_CHANGED_BASE"]?.trim();
    const refs = [
      "origin/main",
      ...(changedBase === undefined || changedBase === "" ? [] : [changedBase]),
      "HEAD",
    ];
    let baseText: string | undefined;
    for (const ref of refs) {
      const result = Bun.spawnSync(
        ["git", "show", `${ref}:packages/version-catalog/src/catalog.json`],
        { cwd: import.meta.dirname, stdout: "pipe", stderr: "ignore" },
      );
      if (result.exitCode === 0) {
        baseText = result.stdout.toString("utf8");
        break;
      }
    }
    if (baseText === undefined) return;
    expect(
      findMutatedComponentTagDigests(
        parseVersionCatalogText(baseText),
        parseVersionCatalog(rawCatalog),
      ),
    ).toEqual([]);
  });
});
