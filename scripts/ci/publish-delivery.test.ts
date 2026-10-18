import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { ArtifactVersionSchema } from "@shepherdjerred/delivery/contract";
import {
  buildPublications,
  downloadChartArtifact,
  parsePublicationOptions,
} from "./publish-delivery.ts";
import { readPublicationHandoffs as readProducerHandoffs } from "../lib/ci/delivery-publication-handoffs.ts";
import { imageRuntimeDigests } from "../lib/ci/image-runtime-digests.ts";

const absentChartHandoffs = new Map<string, string>();

/** These fixtures exercise image/chart/site handoffs; TRMNL has its own required-input suite. */
function readPublicationHandoffs(
  staticArchives: boolean,
  read: NonNullable<Parameters<typeof readProducerHandoffs>[1]>,
) {
  return readProducerHandoffs(staticArchives, {
    ...read,
    required: (key) =>
      key === "trmnl-plugin-artifacts"
        ? Promise.resolve("[]")
        : read.required(key),
  });
}

const childDigest = `sha256:${"a".repeat(64)}`;
const index = JSON.stringify({
  schemaVersion: 2,
  mediaType: "application/vnd.oci.image.index.v1+json",
  manifests: [
    { digest: childDigest, platform: { architecture: "amd64", os: "linux" } },
    {
      digest: `sha256:${"b".repeat(64)}`,
      platform: { architecture: "unknown", os: "unknown" },
    },
  ],
});

const scoutReceipt = {
  serviceId: "scout-for-lol",
  artifact: {
    id: "ci/1/42/site/scout-frontend",
    component: "site:scout-frontend",
    kind: "archive",
    uri: "s3://delivery-artifacts/sites/scout-frontend/archive.tar",
    digest: childDigest,
    version: "build-42",
  },
};

describe("explicit static archive publication", () => {
  test("strict options default to catalog-only and reject unknown inputs", () => {
    expect(parsePublicationOptions([])).toEqual({ staticArchives: false });
    expect(parsePublicationOptions(["--static-archives"])).toEqual({
      staticArchives: true,
    });
    expect(() => parsePublicationOptions(["--archives"])).toThrow();
    expect(() => parsePublicationOptions(["unexpected"])).toThrow();
  });

  test("catalog-only does not read static producer handoffs", async () => {
    const reads: string[] = [];
    const result = await readPublicationHandoffs(false, {
      required: async (key) => {
        reads.push(key);
        if (key === "delivery-chart-publications")
          return JSON.stringify(freshCharts);
        if (key !== "delivery-image-digests")
          throw new Error("Unexpected static producer dependency");
        return JSON.stringify({ "shepherdjerred/arcade": indexDigest });
      },
      optional: async (key) => {
        reads.push(key);
        return JSON.stringify([{ name: "arcade", revision: "2.0.0-42" }]);
      },
    });
    expect(reads).toEqual([
      "delivery-image-digests",
      "argocd-release-expected",
      "delivery-chart-publications",
    ]);
    expect(result.siteArtifacts).toEqual([]);
  });

  test.each(["site-artifacts", "scout-site-artifacts"])(
    "enabled archive publication requires the %s producer receipt",
    async (missing) => {
      await expect(
        readPublicationHandoffs(true, {
          required: async (key) => {
            if (key === missing) throw new Error(`Missing producer ${key}`);
            return key === "delivery-image-digests" ? "{}" : "[]";
          },
          optional: async (key) => absentChartHandoffs.get(key),
        }),
      ).rejects.toThrow(`Missing producer ${missing}`);
    },
  );

  test("an explicit producer no-op remains valid", async () => {
    const result = await readPublicationHandoffs(true, {
      required: async (key) => (key === "delivery-image-digests" ? "{}" : "[]"),
      optional: async (key) => absentChartHandoffs.get(key),
    });
    expect(result.siteArtifacts).toEqual([]);
  });

  test("matching archive producer receipts preserve the published artifact", async () => {
    const result = await readPublicationHandoffs(true, {
      required: async (key) =>
        key === "delivery-image-digests"
          ? "{}"
          : JSON.stringify([scoutReceipt]),
      optional: async (key) => absentChartHandoffs.get(key),
    });
    expect(result.siteArtifacts).toMatchObject([scoutReceipt]);
  });

  test("a Scout archive cannot disappear from the combined producer handoff", async () => {
    await expect(
      readPublicationHandoffs(true, {
        required: async (key) =>
          key === "delivery-image-digests"
            ? "{}"
            : key === "site-artifacts"
              ? "[]"
              : JSON.stringify([scoutReceipt]),
        optional: async (key) => absentChartHandoffs.get(key),
      }),
    ).rejects.toThrow("omitted or changed a Scout producer artifact");
  });
});
const indexDigest = `sha256:${createHash("sha256").update(index).digest("hex")}`;
const ci = {
  sourceRevision: "c".repeat(40),
  ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/42",
  pipelineNumber: 42,
  repositoryId: 1,
  capturedAt: "2026-10-16T00:00:00.000Z",
};
const freshCharts = {
  schema: "delivery-chart-publications/v1",
  sourceRevision: ci.sourceRevision,
  pipelineNumber: ci.pipelineNumber,
  repositoryId: ci.repositoryId,
  charts: [{ name: "arcade", revision: "2.0.0-42", digest: childDigest }],
};

test("retained release inventory is never republished as a fresh CI chart", async () => {
  const result = await readPublicationHandoffs(false, {
    required: async (key) =>
      key === "delivery-image-digests"
        ? "{}"
        : JSON.stringify({ ...freshCharts, charts: [] }),
    optional: async () =>
      JSON.stringify([{ name: "arcade", revision: "2.0.0-41" }]),
  });
  expect(result.charts).toEqual([]);
  expect(result.chartPublication?.charts).toEqual([]);
});

test("a release inventory without its real chart producer receipt fails loudly", async () => {
  await expect(
    readPublicationHandoffs(false, {
      required: async (key) => {
        if (key === "delivery-image-digests") return "{}";
        throw new Error("missing actual chart publication");
      },
      optional: async () =>
        JSON.stringify([{ name: "arcade", revision: "2.0.0-41" }]),
    }),
  ).rejects.toThrow("missing actual chart publication");
});

test("a fresh chart must match the coordinated root inventory", async () => {
  await expect(
    readPublicationHandoffs(false, {
      required: async (key) =>
        key === "delivery-image-digests" ? "{}" : JSON.stringify(freshCharts),
      optional: async () =>
        JSON.stringify([{ name: "arcade", revision: "2.0.0-41" }]),
    }),
  ).rejects.toThrow("coordinated release inventory");
});

test("chart provenance cannot be moved to a later CI execution", async () => {
  await expect(
    buildPublications(
      {
        ...ci,
        pipelineNumber: 500,
        digests: {},
        charts: freshCharts.charts,
        chartPublication: freshCharts,
      },
      {
        inspectImage: async () => {
          throw new Error("unexpected image read");
        },
        chartArtifact: async () => {
          throw new Error("unexpected chart read");
        },
      },
    ),
  ).rejects.toThrow("another source or CI execution");
});

function coordinatedHandoffs(chart: string, revision: string) {
  return {
    required: async (key: string) =>
      key === "delivery-image-digests"
        ? "{}"
        : JSON.stringify({
            ...freshCharts,
            charts: [{ name: chart, revision, digest: childDigest }],
          }),
    optional: async () =>
      JSON.stringify([{ name: "apps", revision: "2.0.0-1000042" }]),
  };
}

test("full chart production may include explicitly inactive charts without adding them to root ownership", async () => {
  const result = await readPublicationHandoffs(
    false,
    coordinatedHandoffs("delivery", "2.0.0-1000042"),
  );
  expect(result.charts?.map((chart) => chart.name)).toEqual(["delivery"]);
  expect(result.rootInventory?.map((chart) => chart.name)).toEqual(["apps"]);
  await expect(
    readPublicationHandoffs(
      false,
      coordinatedHandoffs("arcade", "2.0.0-1000042"),
    ),
  ).rejects.toThrow("coordinated release inventory");
  await expect(
    readPublicationHandoffs(
      false,
      coordinatedHandoffs("apps", "2.0.0-1000043"),
    ),
  ).rejects.toThrow("coordinated release inventory");
});

test.each([false, true])(
  "genuine CI retains the original acquired upstream chart without cloning it (new image: %s)",
  async (newImage) => {
    const original = ArtifactVersionSchema.parse({
      id: "upstream/minecraft/original",
      buildId: "upstream/minecraft/build",
      serviceId: "minecraft",
      component: "chart:minecraft",
      kind: "chart",
      uri: "https://chartmuseum.sjer.red/charts/minecraft-5.2.0.tgz",
      digest: childDigest,
      version: "5.2.0",
      sourceRevision: "a".repeat(40),
      createdAt: ci.capturedAt,
      origin: {
        kind: "upstream",
        repository: "https://itzg.github.io/minecraft-server-charts/",
        name: "minecraft",
        version: "5.2.0",
        checksum: childDigest,
      },
    });
    const [publication] = await buildPublications(
      {
        ...ci,
        digests: newImage
          ? { "shepherdjerred/the-storm-server": indexDigest }
          : {},
        charts: [],
        retainedArtifacts: [original],
      },
      {
        inspectImage: async () => index,
        chartArtifact: async () => {
          throw new Error("Retained archive is not republished");
        },
      },
    );
    expect(publication?.sourceRevision).toBe(ci.sourceRevision);
    expect(publication?.retainedArtifactIds).toEqual([original.id]);
    expect(
      publication?.artifacts.map((artifact) => artifact.component),
    ).toEqual(newImage ? ["image:the-storm-server"] : []);
    expect(original.sourceRevision).toBe("a".repeat(40));
    expect(original.buildId).toBe("upstream/minecraft/build");
  },
);
function requestUrl(input: string | URL | Request) {
  return input instanceof Request ? input.url : String(input);
}

test("new TaskNotes API and Obsidian publications share the application release owner", async () => {
  const publications = await buildPublications(
    {
      ...ci,
      digests: {
        "shepherdjerred/tasknotes-server": indexDigest,
        "shepherdjerred/obsidian-headless": indexDigest,
      },
      charts: undefined,
    },
    {
      inspectImage: async () => index,
      chartArtifact: async () => {
        throw new Error("Unexpected chart publication");
      },
    },
  );
  expect(publications).toHaveLength(1);
  expect(publications[0]?.serviceId).toBe("tasknotes-server");
  expect(
    publications[0]?.artifacts.map((artifact) => artifact.component),
  ).toEqual(["image:tasknotes-server", "image:obsidian-headless"]);
  expect(
    publications[0]?.artifacts.every((artifact) =>
      artifact.id.startsWith("ci/1/42/image/"),
    ),
  ).toBe(true);
});

describe("immutable CI artifact publication", () => {
  test("content-verifies OCI index and retains runtime child manifests", () => {
    expect(imageRuntimeDigests(index, indexDigest)).toEqual([childDigest]);
    expect(imageRuntimeDigests(`${index}\n`, indexDigest)).toEqual([
      childDigest,
    ]);
    expect(() => imageRuntimeDigests(index, childDigest)).toThrow(
      "manifest bytes",
    );
  });
  test("single-platform manifests require a real config and layers", () => {
    const raw = JSON.stringify({
      schemaVersion: 2,
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      config: { digest: childDigest },
      layers: [],
    });
    const digest = `sha256:${createHash("sha256").update(raw).digest("hex")}`;
    expect(imageRuntimeDigests(raw, digest)).toEqual([]);
  });
  test("groups artifacts by catalog service and keeps stable component keys", async () => {
    const publications = await buildPublications(
      {
        ...ci,
        digests: { "shepherdjerred/arcade": indexDigest },
        charts: [{ name: "arcade", revision: "2.0.0-42" }],
      },
      {
        inspectImage: async (reference) => {
          expect(reference).toBe(
            `docker.io/shepherdjerred/arcade@${indexDigest}`,
          );
          return index;
        },
        chartArtifact: async () => ({
          uri: "https://chartmuseum.sjer.red/charts/arcade-2.0.0-42.tgz",
          digest: childDigest,
        }),
      },
    );
    expect(publications).toHaveLength(1);
    expect(publications[0]?.serviceId).toBe("arcade");
    expect(
      publications[0]?.artifacts.find((entry) => entry.kind === "image")
        ?.version,
    ).toBe("2.0.0-1000042");
    expect(publications[0]?.artifacts.map((entry) => entry.component)).toEqual([
      "image:arcade",
      "chart:arcade",
    ]);
    expect(publications[0]?.artifacts[0]?.runtimeDigests).toEqual([
      childDigest,
    ]);
  });
  test("a legitimate chart no-op and empty image map publish nothing", async () => {
    const publications = await buildPublications(
      { ...ci, digests: {}, charts: undefined },
      {
        inspectImage: async () => {
          throw new Error("unexpected image inspection");
        },
        chartArtifact: async () => {
          throw new Error("unexpected chart read");
        },
      },
    );
    expect(publications).toEqual([]);
  });
  test("unknown ownership and invalid image handoff fail loudly", async () => {
    const dependencies = {
      inspectImage: async () => index,
      chartArtifact: async () => ({
        uri: "https://chartmuseum.sjer.red/charts/unknown-1.tgz",
        digest: childDigest,
      }),
    };
    await expect(
      buildPublications(
        {
          ...ci,
          digests: { "shepherdjerred/unregistered": indexDigest },
          charts: undefined,
        },
        dependencies,
      ),
    ).rejects.toThrow("service catalog owner");
    await expect(
      buildPublications(
        {
          ...ci,
          digests: {},
          charts: [{ name: "unregistered", revision: "1" }],
        },
        dependencies,
      ),
    ).rejects.toThrow("service catalog owner");
    await expect(
      buildPublications(
        {
          ...ci,
          digests: { "shepherdjerred/arcade": "latest" },
          charts: undefined,
        },
        dependencies,
      ),
    ).rejects.toThrow();
  });
  test("release channel keys resolve to one immutable image component", async () => {
    const publications = await buildPublications(
      {
        ...ci,
        digests: {
          "shepherdjerred/scout-for-lol/beta": indexDigest,
          "shepherdjerred/scout-for-lol/workflow-candidate": indexDigest,
        },
        charts: undefined,
      },
      {
        inspectImage: async () => index,
        chartArtifact: async () => {
          throw new Error("unexpected chart read");
        },
      },
    );
    expect(publications[0]?.serviceId).toBe("scout-for-lol");
    expect(publications[0]?.artifacts).toHaveLength(1);
    expect(publications[0]?.artifacts[0]?.component).toBe(
      "image:scout-for-lol",
    );
  });
  test("chart bytes are checked against exact version metadata", async () => {
    const archive = "immutable chart archive fixture";
    const digest = createHash("sha256").update(archive).digest("hex");
    const requests: string[] = [];
    const result = await downloadChartArtifact("arcade", "2.0.0-42", {
      origin: "https://chartmuseum.sjer.red",
      fetch: async (url) => {
        requests.push(requestUrl(url));
        return requestUrl(url).includes("/api/")
          ? Response.json({
              name: "arcade",
              version: "2.0.0-42",
              digest,
              urls: ["charts/arcade-2.0.0-42.tgz"],
            })
          : new Response(archive);
      },
    });
    expect(result).toEqual({
      uri: "https://chartmuseum.sjer.red/charts/arcade-2.0.0-42.tgz",
      digest: `sha256:${digest}`,
    });
    expect(requests).toHaveLength(2);
  });
  test("mismatched chart checksum is never registered", async () => {
    await expect(
      downloadChartArtifact("arcade", "2.0.0-42", {
        origin: "https://chartmuseum.sjer.red",
        fetch: async (url) =>
          requestUrl(url).includes("/api/")
            ? Response.json({
                name: "arcade",
                version: "2.0.0-42",
                digest: "a".repeat(64),
                urls: ["charts/arcade-2.0.0-42.tgz"],
              })
            : new Response("changed bytes"),
      }),
    ).rejects.toThrow("checksum mismatch");
  });
});
