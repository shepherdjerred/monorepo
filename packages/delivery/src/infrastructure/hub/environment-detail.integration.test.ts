import { describe, expect, test } from "vitest";
import { environmentDetail } from "#infrastructure/hub/lists.ts";
import { useDeliveryFixture } from "#testing/delivery-fixture.ts";
import { requestStackDeployment } from "#testing/tofu-stack-fixture.ts";

/**
 * An environment of a service only the v2 catalog declares (a tofu stack)
 * opens with its catalog title and its group's kind, as `toolkit deploy
 * start` reads it before admitting a release.
 */
const context = useDeliveryFixture();

describe("environment detail", () => {
  test("summarises a service only the v2 catalog declares", async () => {
    const { deployment } = await requestStackDeployment(context);
    const detail = await environmentDetail(
      context.cluster.database,
      "tofu-cloudflare/prod",
    );
    expect(detail.service).toEqual({
      id: "tofu-cloudflare",
      title: "OpenTofu cloudflare stack",
      kind: "platform",
      links: [],
    });
    expect(detail.releaseKind).toBe("deploy");
    expect(detail.deployments.map((row) => row.id)).toEqual([deployment.id]);
  });
});
