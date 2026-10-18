import { expect, test } from "vitest";
import { parseCatalog, SERVICE_CATALOG, ServiceIndex } from "./catalog.ts";
import {
  PLATFORM_POLICY,
  TOFU_STACK_POLICIES,
  TofuStackSchema,
  tofuStackPolicy,
} from "./platform-policy.ts";

test("root selection uses canonical chart owners and excludes upstream, inactive and delegated targets", () => {
  const charts = new ServiceIndex(
    parseCatalog({ ...SERVICE_CATALOG, deliveryDelegations: {} }),
  ).rootReleaseCharts();
  expect(charts).toContainEqual({ name: "apps", serviceId: "gitops" });
  expect(charts).toContainEqual({ name: "temporal", serviceId: "temporal" });
  for (const name of [
    "minecraft",
    "minecraft-tsmc",
    "delivery",
    "storm-forum-beta",
    "argocd",
  ])
    expect(charts.map((chart) => chart.name)).not.toContain(name);
  expect(new Set(charts.map((chart) => chart.name)).size).toBe(charts.length);
  const delegated = new ServiceIndex(
    parseCatalog({
      ...SERVICE_CATALOG,
      deliveryDelegations: { arcade: "arcade/prod" },
    }),
  ).rootReleaseCharts();
  expect(delegated).toEqual(charts.filter((chart) => chart.name !== "arcade"));
  const activated = new ServiceIndex().rootReleaseCharts();
  expect(Object.keys(SERVICE_CATALOG.deliveryDelegations ?? {})).toHaveLength(
    20,
  );
  for (const name of Object.keys(SERVICE_CATALOG.deliveryDelegations ?? {}))
    expect(activated.map((chart) => chart.name)).not.toContain(name);
});

test("a root exclusion must name inventory owned by its service", () => {
  expect(() =>
    parseCatalog({
      services: [
        {
          id: "test",
          title: "test",
          kind: "platform",
          namespaces: [],
          argoApps: [],
          rootReleaseExclusions: { unknown: "upstream" },
        },
      ],
    }),
  ).toThrow(/must belong to service/u);
});

test("platform modes and dependency order preserve existing release controls", () => {
  expect(Object.keys(TOFU_STACK_POLICIES).sort()).toEqual(
    [...TofuStackSchema.options].sort(),
  );
  expect(
    Object.entries(TOFU_STACK_POLICIES)
      .filter(([, policy]) => policy.mode === "automatic")
      .map(([stack]) => stack)
      .sort(),
  ).toEqual([
    "arr",
    "cloudflare",
    "github",
    "posthog",
    "seaweedfs",
    "tailscale",
  ]);
  expect(
    Object.entries(TOFU_STACK_POLICIES)
      .filter(([, policy]) => policy.mode === "reviewed-plan")
      .map(([stack]) => stack)
      .sort(),
  ).toEqual(["anthropic", "cloudflare-tokens", "discord", "openai"]);
  expect(PLATFORM_POLICY.rootPrerequisites).toEqual([
    "tofu:seaweedfs",
    "tofu:tailscale",
    "tofu:arr",
  ]);
  expect(tofuStackPolicy("tailscale").prerequisites).toEqual([
    "tofu:seaweedfs",
  ]);
  expect(tofuStackPolicy("arr").prerequisites).toEqual(["tofu:tailscale"]);
  expect(tofuStackPolicy("cloudflare").prerequisites).toEqual([
    "root",
    "static-sites",
  ]);
  expect(TofuStackSchema.safeParse("tailscale-delivery").success).toBe(false);
  expect(tofuStackPolicy("application-secrets").mode).toBe("validate-only");
  expect(TofuStackSchema.safeParse("unknown").success).toBe(false);
});
