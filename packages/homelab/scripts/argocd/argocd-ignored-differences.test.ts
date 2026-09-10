import { describe, expect, test } from "vitest";
import { analyzeApplySafety } from "./argocd-apply-safety.ts";
import { withIgnoredDifferencesApplied } from "./argocd-ignored-differences.ts";

function state(value: unknown): string {
  return JSON.stringify(value);
}

// The live Minecraft case: an itzg chart bump moves only the chart-version
// labels inside the claim template, which the Application already ignores.
function claimTemplate(chartVersion: string): unknown {
  return {
    metadata: {
      name: "datadir",
      labels: { chart: `minecraft-${chartVersion}` },
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      resources: { requests: { storage: "32Gi" } },
    },
  };
}

function statefulSet(serviceName: string, chartVersion: string): string {
  return state({
    spec: {
      serviceName,
      selector: { matchLabels: { app: "minecraft-sjerred" } },
      volumeClaimTemplates: [claimTemplate(chartVersion)],
    },
  });
}

function minecraftStatefulSet(
  targetState: string = statefulSet("minecraft-sjerred", "5.1.3"),
) {
  return {
    group: "apps",
    kind: "StatefulSet",
    namespace: "minecraft-sjerred",
    name: "minecraft-sjerred",
    liveState: statefulSet("minecraft-sjerred", "5.1.0"),
    targetState,
  };
}

function application(
  ignoreDifferences: readonly unknown[],
  syncOptions: readonly string[],
): unknown {
  return { spec: { ignoreDifferences, syncPolicy: { syncOptions } } };
}

const claimTemplateRule = {
  group: "apps",
  kind: "StatefulSet",
  jsonPointers: ["/spec/volumeClaimTemplates"],
};

const CLAIM_TEMPLATE_FINDING =
  "apps/StatefulSet minecraft-sjerred/minecraft-sjerred changes immutable /spec/volumeClaimTemplates";

describe("ArgoCD ignored differences", () => {
  test("does not refuse a change the sync will never send", () => {
    expect(
      analyzeApplySafety(
        withIgnoredDifferencesApplied(
          [minecraftStatefulSet()],
          application(
            [claimTemplateRule],
            ["ServerSideApply=true", "RespectIgnoreDifferences=true"],
          ),
        ),
      ),
    ).toEqual([]);
  });

  test("still checks a field the sync applies despite the ignored diff", () => {
    // Without RespectIgnoreDifferences the field is hidden from the diff but
    // still applied, so the API server can still reject it.
    expect(
      analyzeApplySafety(
        withIgnoredDifferencesApplied(
          [minecraftStatefulSet()],
          application([claimTemplateRule], ["ServerSideApply=true"]),
        ),
      ),
    ).toEqual([CLAIM_TEMPLATE_FINDING]);
  });

  test("keeps checking an immutable field the rule does not cover", () => {
    expect(
      analyzeApplySafety(
        withIgnoredDifferencesApplied(
          [minecraftStatefulSet(statefulSet("renamed", "5.1.3"))],
          application([claimTemplateRule], ["RespectIgnoreDifferences=true"]),
        ),
      ),
    ).toEqual([
      "apps/StatefulSet minecraft-sjerred/minecraft-sjerred changes immutable /spec/serviceName",
    ]);
  });

  test("ignores a rule that selects another resource", () => {
    expect(
      analyzeApplySafety(
        withIgnoredDifferencesApplied(
          [minecraftStatefulSet()],
          application(
            [{ ...claimTemplateRule, name: "minecraft-tsmc" }],
            ["RespectIgnoreDifferences=true"],
          ),
        ),
      ),
    ).toEqual([CLAIM_TEMPLATE_FINDING]);
  });

  test("refuses to relax a selector it cannot resolve", () => {
    // jqPathExpressions needs a jq engine, so the entry exempts nothing.
    expect(
      analyzeApplySafety(
        withIgnoredDifferencesApplied(
          [minecraftStatefulSet()],
          application(
            [
              {
                group: "apps",
                kind: "StatefulSet",
                jqPathExpressions: [".spec.volumeClaimTemplates"],
              },
            ],
            ["RespectIgnoreDifferences=true"],
          ),
        ),
      ),
    ).toEqual([CLAIM_TEMPLATE_FINDING]);
  });

  test("prunes a pointer that addresses part of an immutable field", () => {
    expect(
      analyzeApplySafety(
        withIgnoredDifferencesApplied(
          [minecraftStatefulSet(statefulSet("renamed", "5.1.0"))],
          application(
            [
              {
                group: "apps",
                kind: "StatefulSet",
                jsonPointers: ["/spec/serviceName"],
              },
            ],
            ["RespectIgnoreDifferences=true"],
          ),
        ),
      ),
    ).toEqual([]);
  });

  test("refuses to prune a pointer that indexes into a list", () => {
    // Dropping one entry renumbers its siblings, so the pruned document would
    // no longer describe what Argo applies.
    expect(
      analyzeApplySafety(
        withIgnoredDifferencesApplied(
          [minecraftStatefulSet()],
          application(
            [
              {
                group: "apps",
                kind: "StatefulSet",
                jsonPointers: ["/spec/volumeClaimTemplates/0/metadata/labels"],
              },
            ],
            ["RespectIgnoreDifferences=true"],
          ),
        ),
      ),
    ).toEqual([CLAIM_TEMPLATE_FINDING]);
  });

  test("leaves resources untouched when the app declares no rules", () => {
    const resources = [minecraftStatefulSet()];
    expect(
      withIgnoredDifferencesApplied(resources, {
        spec: {
          syncPolicy: { syncOptions: ["RespectIgnoreDifferences=true"] },
        },
      }),
    ).toEqual(resources);
  });
});
