import { expect, test } from "vitest";
import {
  ArtifactVersionSchema,
  EnvironmentSchema,
  OverviewSchema,
  VersionSetRevisionSchema,
} from "@shepherdjerred/delivery/contract";
import { publishedProfileInputs } from "#lib/mc/published-profile.ts";

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
              configurationRevision: "minecraft/1",
              configuration: {},
              promotionSourceEnvironmentId: null,
              generation: 1,
              approvalRequired: false,
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
