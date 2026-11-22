import { describe, expect, test } from "vitest";
import { BuildWithArtifactsSchema } from "#shared/hub/hub-contract.ts";
import { renderWithRouter } from "#client/test-router.tsx";
import { BuildTable } from "./artifacts.tsx";

describe("the artifact catalog", () => {
  test("the artifact catalog names a service as the overview does, with its slug beneath", () => {
    const build = BuildWithArtifactsSchema.parse({
      id: "5d2f7c0e-96aa-4f43-8d0c-0d5a6f7a6a11",
      serviceId: "tofu-tailscale",
      sourceRevision: "a".repeat(40),
      ciUrl: null,
      status: "verified",
      qualificationReason: null,
      createdAt: "2026-10-16T00:00:00.000Z",
      pipelineNumber: null,
      links: [],
      artifacts: [],
    });
    const html = renderWithRouter(
      <BuildTable
        builds={[build]}
        names={{
          service: (id) =>
            id === "tofu-tailscale" ? "OpenTofu tailscale stack" : id,
          environment: (id) => id,
        }}
      />,
    );
    expect(html).toContain("<strong>OpenTofu tailscale stack</strong>");
    expect(html).toContain('<small class="mono">tofu-tailscale</small>');
    // The build's own id is only a hover title.
    expect(html).toContain(
      'title="Build 5d2f7c0e-96aa-4f43-8d0c-0d5a6f7a6a11"',
    );
    expect(html).not.toContain(">5d2f7c0e-96aa-4f43-8d0c-0d5a6f7a6a11<");
  });
});
