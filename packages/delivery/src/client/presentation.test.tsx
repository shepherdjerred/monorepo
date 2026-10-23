import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EnvironmentSchema } from "#shared/contract.ts";
import { BuildWithArtifactsSchema } from "#shared/hub/hub-contract.ts";
import { EnvironmentState } from "#client/components/environment-state.tsx";
import { canApprove, observation, versionLabel } from "./presentation.ts";
import { BuildCatalog } from "./artifacts.tsx";
import { renderWithRouter } from "./test-router.tsx";

const environment = EnvironmentSchema.parse({
  id: "arcade/prod",
  serviceId: "arcade",
  name: "production",
  application: "arcade",
  pipelineRevisionId: "pipeline:arcade:1",
  declaredConfigurationId: "config:1",
  automatic: true,
  promotionSourceEnvironmentId: null,
  role: "durable",
  lifecycle: "active",
  approvalPolicy: "none",
  acceptedDeploymentId: null,
  generation: 1,
  desiredVersionSetRevisionId: "arcade:2",
  observedVersionSetRevisionId: "arcade:1",
  acceptedVersionSetRevisionId: null,
  observedAt: null,
  activeDeploymentId: null,
  createdAt: "2026-10-16T00:00:00.000Z",
});

describe("release state presentation", () => {
  test("failed CI qualification explains why published artifacts are ineligible", () => {
    const build = BuildWithArtifactsSchema.parse({
      id: "build:1",
      serviceId: "arcade",
      sourceRevision: "a".repeat(40),
      ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/1",
      status: "failed",
      qualificationReason:
        "Selected component requires a different backend digest",
      createdAt: "2026-10-16T00:00:00.000Z",
      pipelineNumber: 1,
      links: [],
      artifacts: [],
    });
    const html = renderWithRouter(<BuildCatalog builds={[build]} />);
    expect(html).toContain("failed");
    expect(html).toContain("requires a different backend digest");
    expect(html).toContain("View CI");
    expect(html).toContain('href="/builds/build%3A1"');
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
    const html = renderToStaticMarkup(
      <EnvironmentState environment={environment} versions={[]} now={0} />,
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
