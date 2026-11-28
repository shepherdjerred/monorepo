import { describe, expect, it } from "vitest";
import { assertComparedApplication } from "./argocd-proof.ts";

describe("sync guards require a completed Argo comparison", () => {
  it("refuses media while its comparison failed at 2.0.0-1019523", () => {
    // streambot/prod deploy 05f92aab reached its prune guards in this state.
    expect(() => {
      assertComparedApplication("media", {
        status: {
          sync: { status: "Unknown", revision: "2.0.0-1019523" },
          conditions: [
            {
              type: "ComparisonError",
              message:
                'Deployment.apps "media-qbittorrent" is invalid: spec.template.spec.initContainers[1].name: Duplicate value: "gluetun"',
            },
          ],
        },
      });
    }).toThrow(
      /Sync guards refuse media until Argo completes its comparison: media has ComparisonError.*Duplicate value: "gluetun"/,
    );
  });

  it("lets a compared Application reach its guards", () => {
    expect(() => {
      assertComparedApplication("media", {
        status: { sync: { status: "OutOfSync" } },
      });
    }).not.toThrow();
  });
});
