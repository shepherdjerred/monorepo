import { expect, test } from "vitest";
import { DeliveryClientError } from "../../../packages/delivery/src/shared/client-error.ts";
import { ArtifactVersionSchema } from "../../../packages/delivery/src/shared/artifact-contract.ts";
import {
  CANONICAL_IMAGE_TARGETS,
  imageIdentity,
  qualifiedImage,
  unbuiltImageOriginals,
  chartPublicationImages,
} from "../../../scripts/lib/image-pin-catalog.ts";
import {
  currentPipelineNumber,
  readRetainableImages,
} from "./live-version-catalog.ts";
import { includeMissingQualifiedImages } from "../selectors/select-image-targets-pins.ts";
import {
  ServiceIndex,
  SERVICE_CATALOG,
} from "../../../packages/ops-model/src/catalog.ts";

test("full fresh publication works before environment registration without inventing accepted state", async () => {
  const fresh = Object.fromEntries(
    CANONICAL_IMAGE_TARGETS.map((name) => [
      `shepherdjerred/${name}`,
      `sha256:${"d".repeat(64)}`,
    ]),
  );
  const result = await chartPublicationImages(
    (key) =>
      Promise.resolve(
        JSON.stringify(key === "delivery-image-digests" ? fresh : []),
      ),
    {
      overview: () => Promise.resolve({ environments: [] }),
      latestQualifiedArtifact: () => {
        throw new Error(
          "Fresh outputs must not require an earlier qualified image",
        );
      },
      version: () => {
        throw new Error("No accepted release exists");
      },
    },
  );
  expect(result).toEqual({
    ...fresh,
    "shepherdjerred/the-storm-server/candidate":
      fresh["shepherdjerred/the-storm-server"],
  });
  expect(result).not.toHaveProperty("shepherdjerred/the-storm-server/accepted");
});

test("chart bytes reuse original dependencies while sandbox permissions freeze only actual candidate and accepted metadata", async () => {
  const candidate = original("the-storm-server");
  const accepted = {
    ...candidate,
    id: "minecraft/accepted/original",
    digest: `sha256:${"c".repeat(64)}`,
  };
  const read = (key: string) =>
    Promise.resolve(
      key === "delivery-image-digests"
        ? JSON.stringify({
            "shepherdjerred/delivery": `sha256:${"d".repeat(64)}`,
          })
        : JSON.stringify([original("caddy-s3proxy")]),
    );
  const client = {
    latestQualifiedArtifact: () => Promise.resolve(candidate),
    overview: () =>
      Promise.resolve({
        environments: [
          {
            id: "minecraft/tsmc",
            acceptedVersionSetRevisionId: "minecraft/accepted",
          },
        ],
      }),
    version: () =>
      Promise.resolve({
        serviceId: "minecraft",
        components: { "image:the-storm-server": accepted },
      }),
  };
  expect(await chartPublicationImages(read, client)).toEqual({
    "shepherdjerred/delivery": `sha256:${"d".repeat(64)}`,
    "shepherdjerred/caddy-s3proxy": original("caddy-s3proxy").digest,
    "shepherdjerred/the-storm-server/candidate": candidate.digest,
    "shepherdjerred/the-storm-server/accepted": accepted.digest,
  });
  const noAccepted = await chartPublicationImages(read, {
    ...client,
    overview: () =>
      Promise.resolve({
        environments: [
          { id: "minecraft/tsmc", acceptedVersionSetRevisionId: null },
        ],
      }),
  });
  expect(noAccepted).not.toHaveProperty(
    "shepherdjerred/the-storm-server/accepted",
  );
  await expect(
    chartPublicationImages(
      () => Promise.resolve(JSON.stringify({ unknown: "latest" })),
      client,
    ),
  ).rejects.toThrow();
  await expect(
    chartPublicationImages(
      (key) =>
        Promise.resolve(
          key === "delivery-image-digests"
            ? JSON.stringify({
                "shepherdjerred/caddy-s3proxy": candidate.digest,
              })
            : JSON.stringify([original("caddy-s3proxy")]),
        ),
      client,
    ),
  ).rejects.toThrow("overlap");
});

function original(name: string) {
  return ArtifactVersionSchema.parse({
    ...imageIdentity(name),
    id: `ci/1/42/image/${name}`,
    buildId: `ci/1/42/${imageIdentity(name).serviceId}`,
    sourceRevision: "a".repeat(40),
    createdAt: "2026-10-17T12:00:00.000Z",
    digest: `sha256:${"b".repeat(64)}`,
    version: "2.0.0-1000042",
    origin: { kind: "first-party" },
  });
}

test("all22 canonical recipes have a fixed component/repository/owner without Git selected versions", () => {
  expect(CANONICAL_IMAGE_TARGETS).toHaveLength(22);
  expect(new Set(CANONICAL_IMAGE_TARGETS).size).toBe(22);
  expect(CANONICAL_IMAGE_TARGETS).toContain("zfs-driver");
  expect(imageIdentity("zfs-driver")).toMatchObject({
    serviceId: "storage",
    component: "image:zfs-driver",
    kind: "image",
    uri: "docker.io/shepherdjerred/zfs-driver",
  });
  for (const name of CANONICAL_IMAGE_TARGETS) {
    expect(imageIdentity(name)).toMatchObject({
      kind: "image",
      component: `image:${name}`,
      uri: `docker.io/shepherdjerred/${name}`,
    });
  }
  expect(() => imageIdentity("scout-for-lol/prod/workflows/stable")).toThrow(
    "Unknown CI image recipe",
  );
});

test("root chart publication owns only its canonical undelegated charts", () => {
  const index = new ServiceIndex(SERVICE_CATALOG);
  const charts = index.rootReleaseCharts();
  expect(charts.length).toBeGreaterThan(0);
  expect(new Set(charts.map((chart) => chart.name)).size).toBe(charts.length);
  for (const chart of charts) {
    expect(index.byChart(chart.name)?.id).toBe(chart.serviceId);
    expect(SERVICE_CATALOG.deliveryDelegations?.[chart.name]).toBeUndefined();
  }
  expect(charts.map((chart) => chart.name)).not.toContain(
    "delivery-control-plane",
  );
});

test("retainable inventory preserves each original artifact/build/source through no-target and partial publications", async () => {
  const originals = new Map(
    CANONICAL_IMAGE_TARGETS.map((name) => [name, original(name)]),
  );
  const requested: string[] = [];
  const actual = await readRetainableImages(async (query) => {
    const name = query.component.slice("image:".length);
    requested.push(name);
    expect(query).toEqual({
      serviceId: imageIdentity(name).serviceId,
      component: `image:${name}`,
      kind: "image",
      beforePipeline: 43,
    });
    return originals.get(name);
  }, 43);
  expect(requested).toEqual(CANONICAL_IMAGE_TARGETS);
  expect(actual).toEqual(originals);
  expect(unbuiltImageOriginals(actual, [])).toEqual([...originals.values()]);
  expect(unbuiltImageOriginals(actual, ["delivery"])).toEqual(
    [...originals]
      .filter(([name]) => name !== "delivery")
      .map(([, artifact]) => artifact),
  );
  expect(includeMissingQualifiedImages([], actual)).toEqual([]);
});

test("only404 absence selects new builds, including the fixed infra recipe group", async () => {
  const originals = await readRetainableImages(async (query) => {
    const name = query.component.slice("image:".length);
    if (name === "delivery" || name === "redlib")
      throw new DeliveryClientError(
        404,
        "NOT_FOUND",
        "No original qualified artifact",
      );
    return original(name);
  }, 43);
  expect(includeMissingQualifiedImages(["tracker"], originals)).toEqual([
    "delivery",
    "infra",
    "tracker",
  ]);
});

test.each([401, 403, 500])(
  "API status%s cannot become missing-original rebuild or Git/history fallback",
  async (status) => {
    await expect(
      readRetainableImages(async () => {
        throw new DeliveryClientError(status, "HTTP_ERROR", "refused");
      }, 43),
    ).rejects.toMatchObject({ status });
  },
);

test("malformed or foreign qualified identities are refused", async () => {
  await expect(readRetainableImages(async () => ({}), 43)).rejects.toThrow();
  for (const mutation of [
    { serviceId: "arcade" },
    { component: "image:arcade" },
    { uri: "docker.io/foreign/delivery" },
  ]) {
    expect(() =>
      qualifiedImage("delivery", { ...original("delivery"), ...mutation }),
    ).toThrow("canonical owner/component/repository");
  }
  await expect(
    readRetainableImages(async () => {
      throw new Error("network unavailable");
    }, 43),
  ).rejects.toThrow("network unavailable");
});

test("the base bound is this exact main pipeline number", () => {
  expect(currentPipelineNumber({ CI_PIPELINE_NUMBER: "12158" })).toBe(12_158);
  for (const raw of [undefined, "", "0", "012", "1.5", "9".repeat(17)])
    expect(() => currentPipelineNumber({ CI_PIPELINE_NUMBER: raw })).toThrow(
      "CI_PIPELINE_NUMBER must be a positive safe integer",
    );
});
