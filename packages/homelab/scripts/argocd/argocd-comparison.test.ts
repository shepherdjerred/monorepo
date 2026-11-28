import { describe, expect, test } from "vitest";
import { comparisonFindings } from "./argocd-comparison.ts";

// What Argo reported for media at 2.0.0-1019523 on 2026-11-26, while the
// apply-safety preflight still recorded the revision as apply-safe.
const MEDIA_COMPARISON_ERROR =
  'Failed to compare desired state to live state: failed to calculate diff: error calculating server side diff: serverSideDiff error: error running server side apply in dryrun mode for resource Deployment/media-qbittorrent: Deployment.apps "media-qbittorrent" is invalid: spec.template.spec.initContainers[1].name: Duplicate value: "gluetun"';

function application(status: unknown) {
  return { metadata: { name: "media" }, status };
}

describe("Argo comparison completeness", () => {
  test("refuses the media ComparisonError and names Argo's reason", () => {
    const findings = comparisonFindings(
      "media",
      application({
        sync: { status: "Unknown", revision: "2.0.0-1019523" },
        conditions: [
          {
            type: "ComparisonError",
            message: MEDIA_COMPARISON_ERROR,
            lastTransitionTime: "2026-11-26T19:40:11Z",
          },
        ],
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("media has ComparisonError");
    expect(findings[0]).toContain('Duplicate value: "gluetun"');
  });

  test("refuses an invalid spec", () => {
    expect(
      comparisonFindings(
        "scout-prod",
        application({
          sync: { status: "Unknown" },
          conditions: [
            {
              type: "InvalidSpecError",
              message: "application repo is not permitted in project",
            },
          ],
        }),
      ),
    ).toEqual([expect.stringContaining("scout-prod has InvalidSpecError")]);
  });

  test("refuses an Unknown sync status that carries no condition", () => {
    expect(
      comparisonFindings("media", application({ sync: { status: "Unknown" } })),
    ).toEqual([expect.stringContaining("reports sync status Unknown")]);
  });

  test("passes a completed comparison, drifted or not", () => {
    for (const status of ["Synced", "OutOfSync"])
      expect(
        comparisonFindings(
          "media",
          application({
            sync: { status },
            conditions: [
              { type: "OrphanedResourceWarning", message: "orphans" },
              { type: "SyncError", message: "a previous sync failed" },
            ],
          }),
        ),
      ).toEqual([]);
  });

  test("bounds a long condition message", () => {
    const [finding] = comparisonFindings(
      "media",
      application({
        sync: { status: "Unknown" },
        conditions: [{ type: "ComparisonError", message: "x".repeat(5000) }],
      }),
    );
    expect(finding?.length).toBeLessThan(800);
  });
});
