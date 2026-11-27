import { expect, test } from "vitest";
import { DeliveryClientError } from "@shepherdjerred/delivery/client";
import {
  ArtifactVersionSchema,
  EnvironmentSchema,
  OverviewSchema,
  VersionSetRevisionSchema,
} from "@shepherdjerred/delivery/contract";
import {
  publishedProfileInputs,
  registeredReader,
} from "#lib/mc/published-profile.ts";

const original = ArtifactVersionSchema.parse({
  id: "minecraft/image/original",
  buildId: "minecraft/build/original",
  serviceId: "minecraft",
  sourceRevision: "a".repeat(40),
  component: "image:the-storm-server",
  kind: "image",
  uri: "docker.io/shepherdjerred/the-storm-server",
  digest: `sha256:${"b".repeat(64)}`,
  version: "2.0.0-1000001",
  createdAt: "2026-10-18T00:00:00.000Z",
  origin: { kind: "first-party" },
});
function reader(accepted: string | null = "minecraft/accepted") {
  return {
    latestQualifiedArtifact: () => Promise.resolve(original),
    overview: () =>
      Promise.resolve(
        OverviewSchema.parse({
          environments: [
            EnvironmentSchema.parse({
              id: "minecraft/tsmc",
              serviceId: "minecraft",
              name: "prod",
              application: "minecraft-tsmc",
              pipelineRevisionId: "minecraft/1",
              declaredConfigurationId: "minecraft/1",
              automatic: false,
              promotionSourceEnvironmentId: null,
              generation: 1,
              role: "durable",
              lifecycle: "active",
              approvalPolicy: "none",
              acceptedDeploymentId: null,
              desiredVersionSetRevisionId: null,
              observedVersionSetRevisionId: null,
              acceptedVersionSetRevisionId: accepted,
              observedAt: null,
              activeDeploymentId: null,
              createdAt: original.createdAt,
            }),
          ],
          deployments: [],
          versionSets: [],
          artifacts: [],
        }),
      ),
    version: () =>
      Promise.resolve(
        VersionSetRevisionSchema.parse({
          id: "minecraft/accepted",
          serviceId: "minecraft",
          revision: 1,
          baseRevisionId: null,
          lineage: "0".repeat(64),
          orderKey: "0000000001.0000000000",
          components: { "image:the-storm-server": original },
          createdAt: original.createdAt,
        }),
      ),
  };
}

test.each(["storm-prod", "storm-candidate"] as const)(
  "%s freezes the original artifact and its own immutable source configuration",
  async (profile) => {
    const yaml = "modules:\n  companions: false\n";
    const result = await publishedProfileInputs(profile, undefined, {
      client: reader(),
      fetch: (input, init) => {
        expect(input).toBe(
          `https://raw.githubusercontent.com/shepherdjerred/monorepo/${original.sourceRevision}/packages/the-storm/server/owned/plugins/TheStorm/config.yml`,
        );
        expect(init?.redirect).toBe("error");
        return Promise.resolve(new Response(yaml));
      },
    });
    expect(result).toEqual({
      publishedArtifact: original,
      publishedConfig: {
        sourceRevision: original.sourceRevision,
        yaml,
        sha256: new Bun.CryptoHasher("sha256").update(yaml).digest("hex"),
      },
    });
  },
);

test("missing accepted Minecraft state cannot be fabricated from the candidate", async () => {
  await expect(
    publishedProfileInputs("storm-prod", undefined, { client: reader(null) }),
  ).rejects.toThrow("no accepted release");
  expect(await publishedProfileInputs("paper")).toEqual({});
  await expect(
    publishedProfileInputs("paper", "original.json"),
  ).rejects.toThrow("published Storm profile");
});

test.each([
  new Response("absent", { status: 404 }),
  new Response(""),
  new Response("x".repeat(64 * 1024 + 1)),
  new Response(new Uint8Array([255])),
])(
  "unavailable, oversized or corrupt original configuration is refused",
  async (response) => {
    await expect(
      publishedProfileInputs("storm-candidate", undefined, {
        client: reader(),
        fetch: () => Promise.resolve(response),
      }),
    ).rejects.toThrow();
  },
);

test("registeredReader uses Tailscale unauthenticated reads first and falls back to DELIVERY_API_TOKEN on 401", async () => {
  const savedApi = Bun.env["DELIVERY_API_TOKEN"];
  const savedPublisher = Bun.env["DELIVERY_PUBLISHER_TOKEN"];
  Reflect.deleteProperty(Bun.env, "DELIVERY_API_TOKEN");
  Bun.env["DELIVERY_PUBLISHER_TOKEN"] = "publisher-must-never-be-used";
  try {
    const tokensSeen: (string | undefined)[] = [];
    const tailscaleOnly = await registeredReader({
      makeClient: (_url, token) => {
        tokensSeen.push(token);
        return reader();
      },
      resolveApiToken: () => {
        throw new Error("Tailscale read must not resolve DELIVERY_API_TOKEN");
      },
    });
    await tailscaleOnly.overview();
    await tailscaleOnly.version("minecraft/accepted");
    expect(tokensSeen).toEqual([undefined]);

    tokensSeen.length = 0;
    const fallbackClient = await registeredReader({
      deliveryUrl: "https://delivery.tailnet-1a49.ts.net",
      makeClient: (_url, token) => {
        tokensSeen.push(token);
        if (token === undefined) {
          return {
            latestQualifiedArtifact: () => {
              Bun.env["DELIVERY_API_TOKEN"] = "fallback-api-token";
              return Promise.reject(
                new DeliveryClientError(401, "UNAUTHORIZED", "login required"),
              );
            },
            overview: () => {
              Bun.env["DELIVERY_API_TOKEN"] = "fallback-api-token";
              return Promise.reject(
                new DeliveryClientError(401, "UNAUTHORIZED", "login required"),
              );
            },
            version: () =>
              Promise.reject(
                new DeliveryClientError(401, "UNAUTHORIZED", "login required"),
              ),
          };
        }
        return reader();
      },
    });
    await fallbackClient.overview();
    await fallbackClient.version("minecraft/accepted");
    expect(tokensSeen).toEqual([undefined, "fallback-api-token"]);

    Bun.env["DELIVERY_API_TOKEN"] = "ambient-api-token";
    tokensSeen.length = 0;
    const ambientClient = await registeredReader({
      deliveryUrl: "https://delivery.tailnet-1a49.ts.net",
      makeClient: (_url, token) => {
        tokensSeen.push(token);
        return reader();
      },
    });
    await ambientClient.latestQualifiedArtifact({
      serviceId: "minecraft",
      component: "image:the-storm-server",
      kind: "image",
    });
    expect(tokensSeen).toEqual(["ambient-api-token"]);

    Reflect.deleteProperty(Bun.env, "DELIVERY_API_TOKEN");
    const non401 = await registeredReader({
      deliveryUrl: "https://delivery.tailnet-1a49.ts.net",
      makeClient: () => ({
        ...reader(),
        overview: () =>
          Promise.reject(
            new DeliveryClientError(500, "INTERNAL", "server down"),
          ),
      }),
      resolveApiToken: () => {
        throw new Error("non-401 must not fall back to token resolution");
      },
    });
    await expect(non401.overview()).rejects.toThrow("server down");
  } finally {
    if (savedApi === undefined) {
      Reflect.deleteProperty(Bun.env, "DELIVERY_API_TOKEN");
    } else {
      Bun.env["DELIVERY_API_TOKEN"] = savedApi;
    }
    if (savedPublisher === undefined) {
      Reflect.deleteProperty(Bun.env, "DELIVERY_PUBLISHER_TOKEN");
    } else {
      Bun.env["DELIVERY_PUBLISHER_TOKEN"] = savedPublisher;
    }
  }
});
