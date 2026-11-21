import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EnvironmentSchema } from "#shared/contract.ts";
import { BuildWithArtifactsSchema } from "#shared/hub/hub-contract.ts";
import { EnvironmentState } from "#client/components/environment-state.tsx";
import {
  canApprove,
  imageCheckSummary,
  messageNotice,
  observation,
  versionLabel,
} from "./presentation.ts";
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

const image = (index: number) =>
  `docker.io/shepherdjerred/arcade@sha256:${index.toString(16).padStart(64, "0")}`;

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
  test("a missing observation says so", () => {
    expect(observation(environment)).toBe("No runtime observation");
  });
  test.each([
    ["2026-10-16T00:00:20.000Z", "just now"],
    ["2026-10-16T00:10:00.000Z", "10 minutes ago"],
    ["2026-10-16T15:25:00.000Z", "15 hours ago"],
    ["2026-10-19T00:00:00.000Z", "3 days ago"],
  ])(
    "an observation read at %s is dated by the deployment that recorded it: %s",
    (at, age) => {
      const label = observation(
        { ...environment, observedAt: "2026-10-16T00:00:00.000Z" },
        Date.parse(at),
      );
      expect(label).toBe(`Observed when the last deployment finished · ${age}`);
      expect(label).not.toContain("stale");
    },
  );
  test("an old observation renders as a dated claim with no stale marker", () => {
    const html = renderToStaticMarkup(
      <EnvironmentState
        environment={{ ...environment, observedAt: "2026-10-16T00:00:00.000Z" }}
        versions={[]}
        now={Date.parse("2026-10-16T15:25:00.000Z")}
      />,
    );
    expect(html).toContain(
      "Observed when the last deployment finished · 15 hours ago",
    );
    expect(html).not.toContain("stale");
    expect(html).not.toContain("freshness");
  });
  test.each([
    [{ live: 1, retained: 0, unexpected: 0 }, "runs the accepted digest"],
    [
      { live: 2, retained: 1, unexpected: 0 },
      "runs the accepted digest · 1 retained worker build",
    ],
    [
      { live: 12, retained: 11, unexpected: 0 },
      "runs the accepted digest · 11 retained worker builds",
    ],
    [
      { live: 2, retained: 2, unexpected: 0 },
      "does not run the accepted digest · 2 retained worker builds",
    ],
    [
      { live: 1, retained: 0, unexpected: 1 },
      "does not run the accepted digest · 1 unexpected image",
    ],
    [
      { live: 4, retained: 1, unexpected: 2 },
      "runs the accepted digest · 2 unexpected images · 1 retained worker build",
    ],
  ])("image check %j reads %s", (counts, summary) => {
    expect(
      imageCheckSummary({
        component: "image:arcade",
        expected: `sha256:${"0".repeat(64)}`,
        live: Array.from({ length: counts.live }, (_, index) => image(index)),
        retained: counts.retained,
        unexpected: Array.from({ length: counts.unexpected }, (_, index) =>
          image(100 + index),
        ),
        matches:
          counts.live > counts.retained + counts.unexpected &&
          counts.unexpected === 0,
      }),
    ).toBe(summary);
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
  test("a deployment message takes the tone of the outcome it reports", () => {
    expect(messageNotice("succeeded")).toBe("notice success");
    expect(messageNotice("failed")).toBe("notice error");
    expect(messageNotice("running")).toBe("notice info");
    expect(messageNotice("queued")).toBe("notice info");
    expect(messageNotice("awaiting_approval")).toBe("notice info");
    expect(messageNotice("canceled")).toBe("notice");
  });
  test("unknown revision IDs remain visible rather than disappearing", () => {
    expect(versionLabel("missing:revision", [])).toBe("missing:revision");
    expect(versionLabel(null, [])).toBe("Unknown");
  });
});
