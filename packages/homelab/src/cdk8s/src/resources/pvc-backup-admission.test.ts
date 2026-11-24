import { App, Chart } from "cdk8s";
import { describe, expect, it } from "vitest";
import { parseAllDocuments } from "yaml";
import { z } from "zod";
import { PVC_BACKUP_POLICY } from "@shepherdjerred/homelab/cdk8s/src/backup-policy/pvc-backup-policy.ts";
import { createPvcBackupAdmissionPolicies } from "./pvc-backup-admission.ts";

const ValidatingPolicySchema = z.object({
  kind: z.literal("ValidatingAdmissionPolicy"),
  metadata: z.object({
    name: z.literal("pvc-backup-policy.sjer.red"),
  }),
  spec: z.object({
    variables: z.array(
      z.object({
        name: z.string(),
        expression: z.string(),
      }),
    ),
    validations: z.array(
      z.object({
        expression: z.string(),
        message: z.string(),
        reason: z.string(),
      }),
    ),
  }),
});

const EXPECTED_EXPLICIT_LABELS_EXPRESSION =
  "has(object.metadata.labels) && 'velero.io/backup' in object.metadata.labels && 'velero.io/exclude-from-backup' in object.metadata.labels && ((object.metadata.labels['velero.io/backup'] == 'enabled' && object.metadata.labels['velero.io/exclude-from-backup'] == 'false') || (object.metadata.labels['velero.io/backup'] == 'disabled' && object.metadata.labels['velero.io/exclude-from-backup'] == 'true'))";

function synthValidatingPolicy() {
  const app = new App();
  createPvcBackupAdmissionPolicies(new Chart(app, "pvc-backup-admission"));
  const policy = parseAllDocuments(app.synthYaml())
    .map((document) => ValidatingPolicySchema.safeParse(document.toJS()))
    .find((parsed) => parsed.success);
  if (policy?.success !== true) {
    throw new Error("pvc-backup-policy.sjer.red was not synthesized");
  }
  return policy.data;
}

type SimulatedPvc = {
  namespace: string;
  name: string;
  storageClassName?: string;
  labels?: Record<string, string>;
};

function hasEnabledBackupPair(
  labels: Record<string, string> | undefined,
): boolean {
  return (
    labels?.["velero.io/backup"] === "enabled" &&
    labels["velero.io/exclude-from-backup"] === "false"
  );
}

function hasDisabledBackupPair(
  labels: Record<string, string> | undefined,
): boolean {
  return (
    labels?.["velero.io/backup"] === "disabled" &&
    labels["velero.io/exclude-from-backup"] === "true"
  );
}

function isEphemeralClassExcluded(pvc: SimulatedPvc): boolean {
  const isCiWorkspace =
    pvc.namespace === "woodpecker-ci" &&
    pvc.storageClassName === "ci-workspace";
  const isMcCapture =
    pvc.namespace === "minecraft-tsmc" &&
    pvc.name.startsWith("mc-capture-") &&
    pvc.storageClassName === "mc-capture";
  return isCiWorkspace || isMcCapture;
}

function evaluateAdmission(pvc: SimulatedPvc): {
  allowed: boolean;
  failedReasons: string[];
} {
  const policyEntry = PVC_BACKUP_POLICY.find(
    (entry) => entry.namespace === pvc.namespace && entry.name === pvc.name,
  );
  const included = policyEntry?.backup === "enabled";
  const excluded =
    policyEntry?.backup === "disabled" || isEphemeralClassExcluded(pvc);
  const enabledPair = hasEnabledBackupPair(pvc.labels);
  const disabledPair = hasDisabledBackupPair(pvc.labels);
  const explicitLabels = enabledPair || disabledPair;

  const failedReasons: string[] = [];
  if (!(included || excluded || explicitLabels)) {
    failedReasons.push("unclassified");
  }
  if (included && !enabledPair) {
    failedReasons.push("included-mismatch");
  }
  if (excluded && !disabledPair) {
    failedReasons.push("excluded-mismatch");
  }
  return { allowed: failedReasons.length === 0, failedReasons };
}

describe("PVC backup admission policy (AI-494)", () => {
  it("synthesizes explicitLabels and permits explicit Velero label pairs in validation 1 while preserving allowlist disposition checks", () => {
    const policy = synthValidatingPolicy();
    expect(policy.spec.variables).toContainEqual({
      name: "explicitLabels",
      expression: EXPECTED_EXPLICIT_LABELS_EXPRESSION,
    });
    expect(policy.spec.validations).toEqual([
      {
        expression:
          "variables.included || variables.excluded || variables.explicitLabels",
        message:
          "PVC is absent from the explicit backup policy; classify it before creation or update",
        reason: "Forbidden",
      },
      {
        expression:
          "!variables.included || (object.metadata.labels['velero.io/backup'] == 'enabled' && object.metadata.labels['velero.io/exclude-from-backup'] == 'false')",
        message: "Included PVC must have the enabled Velero backup label pair",
        reason: "Invalid",
      },
      {
        expression:
          "!variables.excluded || (object.metadata.labels['velero.io/backup'] == 'disabled' && object.metadata.labels['velero.io/exclude-from-backup'] == 'true')",
        message: "Excluded PVC must have the disabled Velero backup label pair",
        reason: "Invalid",
      },
    ]);
  });

  it("admits a newly introduced PVC before cluster-admission syncs when it carries a valid explicit Velero label pair", () => {
    expect(
      evaluateAdmission({
        namespace: "woodpecker-ci",
        name: "woodpecker-mise-installs-new",
        labels: {
          "velero.io/backup": "enabled",
          "velero.io/exclude-from-backup": "false",
        },
      }),
    ).toEqual({ allowed: true, failedReasons: [] });

    expect(
      evaluateAdmission({
        namespace: "woodpecker-ci",
        name: "woodpecker-mise-installs-new",
        labels: {
          "velero.io/backup": "disabled",
          "velero.io/exclude-from-backup": "true",
        },
      }),
    ).toEqual({ allowed: true, failedReasons: [] });
  });

  const unlistedDeniedCases: {
    caseName: string;
    labels?: Record<string, string>;
  }[] = [
    { caseName: "missing metadata.labels" },
    { caseName: "empty labels", labels: {} },
    {
      caseName: "missing exclude-from-backup",
      labels: { "velero.io/backup": "enabled" },
    },
    {
      caseName: "missing backup",
      labels: { "velero.io/exclude-from-backup": "true" },
    },
    {
      caseName: "contradictory enabled + true",
      labels: {
        "velero.io/backup": "enabled",
        "velero.io/exclude-from-backup": "true",
      },
    },
    {
      caseName: "contradictory disabled + false",
      labels: {
        "velero.io/backup": "disabled",
        "velero.io/exclude-from-backup": "false",
      },
    },
    {
      caseName: "invalid enum values",
      labels: {
        "velero.io/backup": "true",
        "velero.io/exclude-from-backup": "disabled",
      },
    },
  ];

  it.each(unlistedDeniedCases)(
    "denies an unlisted PVC with $caseName",
    ({ labels }) => {
      const decision = evaluateAdmission({
        namespace: "unlisted-ns",
        name: "unlisted-claim",
        ...(labels === undefined ? {} : { labels }),
      });
      expect(decision).toEqual({
        allowed: false,
        failedReasons: ["unclassified"],
      });
    },
  );

  it("denies allowlisted PVCs whose explicit labels contradict their catalog disposition", () => {
    const includedEntry = PVC_BACKUP_POLICY.find(
      (entry) => entry.backup === "enabled",
    );
    const excludedEntry = PVC_BACKUP_POLICY.find(
      (entry) => entry.backup === "disabled",
    );
    if (includedEntry === undefined || excludedEntry === undefined) {
      throw new Error("Expected both enabled and disabled PVC policy entries");
    }

    expect(
      evaluateAdmission({
        namespace: includedEntry.namespace,
        name: includedEntry.name,
        labels: {
          "velero.io/backup": "disabled",
          "velero.io/exclude-from-backup": "true",
        },
      }),
    ).toEqual({
      allowed: false,
      failedReasons: ["included-mismatch"],
    });

    expect(
      evaluateAdmission({
        namespace: excludedEntry.namespace,
        name: excludedEntry.name,
        labels: {
          "velero.io/backup": "enabled",
          "velero.io/exclude-from-backup": "false",
        },
      }),
    ).toEqual({
      allowed: false,
      failedReasons: ["excluded-mismatch"],
    });
  });
});
