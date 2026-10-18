import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EnvironmentSchema, OverviewSchema } from "#shared/contract.ts";
import { EnvironmentCard } from "./components.tsx";
import { canApprove, observation, versionLabel } from "./presentation.ts";
import { BuildCatalog } from "./artifacts.tsx";

const environment = EnvironmentSchema.parse({
  id: "arcade/prod",
  serviceId: "arcade",
  name: "production",
  application: "arcade",
  pipelineRevisionId: "pipeline:arcade:1",
  configurationRevision: "config:1",
  configuration: {},
  automatic: true,
  promotionSourceEnvironmentId: null,
  generation: 1,
  approvalRequired: false,
  desiredVersionSetRevisionId: "arcade:2",
  observedVersionSetRevisionId: "arcade:1",
  acceptedVersionSetRevisionId: null,
  observedAt: null,
  activeDeploymentId: null,
  createdAt: "2026-10-16T00:00:00.000Z",
});

describe("release state presentation", () => {
  test("failed CI qualification explains why published artifacts are ineligible", () => {
    const overview = OverviewSchema.parse({
      environments: [],
      deployments: [],
      artifacts: [],
      versionSets: [],
      builds: [
        {
          id: "build:1",
          serviceId: "arcade",
          sourceRevision: "a".repeat(40),
          ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/1",
          status: "failed",
          qualificationReason:
            "Selected component requires a different backend digest",
          createdAt: "2026-10-16T00:00:00.000Z",
        },
      ],
    });
    const html = renderToStaticMarkup(
      <BuildCatalog builds={overview.builds} />,
    );
    expect(html).toContain("failed");
    expect(html).toContain("requires a different backend digest");
    expect(html).toContain("View CI");
  });
  test("a machine cannot approve even when its scopes contain approve", () => {
    expect(canApprove({ id: "ci", kind: "machine", scopes: ["approve"] })).toBe(
      false,
    );
    expect(
      canApprove({ id: "operator", kind: "human", scopes: ["approve"] }),
    ).toBe(true);
    expect(canApprove({ id: "reader", kind: "human", scopes: ["read"] })).toBe(
      false,
    );
  });
  test("missing and stale observations do not appear fresh", () => {
    expect(observation(environment)).toEqual({
      label: "No runtime observation",
      fresh: false,
    });
    expect(
      observation(
        { ...environment, observedAt: "2026-10-16T00:00:00.000Z" },
        Date.parse("2026-10-16T00:10:00.000Z"),
      ),
    ).toEqual({ label: "10m ago · stale", fresh: false });
  });
  test("renders desired, observed, and unknown acceptance as separate evidence", () => {
    const overview = OverviewSchema.parse({
      environments: [environment],
      deployments: [],
      artifacts: [],
      versionSets: [],
    });
    const html = renderToStaticMarkup(
      <EnvironmentCard
        environment={environment}
        overview={overview}
        onSelect={() => {
          /* Render only. */
        }}
        onDeployment={() => {
          /* Render only. */
        }}
      />,
    );
    expect(html).toContain("Desired");
    expect(html).toContain("arcade:2");
    expect(html).toContain("Observed");
    expect(html).toContain("arcade:1");
    expect(html).toContain("Accepted");
    expect(html).toContain("Unknown");
    expect(html).toContain("No runtime observation");
  });
  test("unknown revision IDs remain visible rather than disappearing", () => {
    expect(versionLabel("missing:revision", [])).toBe("missing:revision");
    expect(versionLabel(null, [])).toBe("Unknown");
  });
});
