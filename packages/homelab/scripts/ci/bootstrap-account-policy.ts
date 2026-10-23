import { z } from "zod";
import {
  DELIVERY_ARGO_ACCOUNTS,
  DELIVERY_ARGO_SERVER_SETTINGS,
  OPERATOR_RUN_ACCOUNT,
  deliveryArgoPolicy,
} from "#cdk8s/src/resources/argo-applications/platform/delivery-rbac.ts";
import type { BootstrapApplication } from "./bootstrap-selection.ts";

const Principals = new Set([
  "delivery",
  "delivery-observer",
  "delivery-platform",
  OPERATOR_RUN_ACCOUNT,
]);
const protectedValues = new Set([
  ...Object.keys({
    ...DELIVERY_ARGO_ACCOUNTS,
    ...DELIVERY_ARGO_SERVER_SETTINGS,
  }).map((key) => `configs.cm.${key}`),
  "configs.rbac.policy.csv",
  "configs.rbac.policy.default",
]);
function deliveryRow(row: string) {
  return Principals.has(row.split(",")[1]?.trim() ?? "");
}

/** Only reviewed accounts/RBAC values change; the running Argo chart and every unrelated setting remain exact. */
export function reviewedAccountSource(application: BootstrapApplication) {
  if (application.metadata.name !== "argocd")
    throw new Error(
      "Account bootstrap only supports the native argocd Application",
    );
  const source = z
    .object({
      repoURL: z.enum([
        "https://argoproj.github.io/argo-helm",
        "https://argoproj.github.io/argo-helm/",
      ]),
      chart: z.literal("argo-cd"),
      targetRevision: z.string(),
      helm: z
        .object({
          valuesObject: z.record(z.string(), z.json()),
          values: z.never().optional(),
          parameters: z
            .array(z.object({ name: z.string(), value: z.string() }).loose())
            .optional(),
        })
        .loose(),
    })
    .loose()
    .parse(application.spec["source"]);
  if (
    source.helm.parameters?.some((parameter) =>
      protectedValues.has(parameter.name.replaceAll(String.raw`\.`, ".")),
    ) === true
  )
    throw new Error(
      "Protected account values have a parameter override; inspect the original source first",
    );
  const values = source.helm.valuesObject;
  const configs = z.record(z.string(), z.json()).parse(values["configs"]);
  const cm = z.record(z.string(), z.json()).parse(configs["cm"]);
  const rbac = z.record(z.string(), z.json()).parse(configs["rbac"]);
  const originalPolicy = z.string().parse(rbac["policy.csv"]);
  if (rbac["policy.default"] !== undefined && rbac["policy.default"] !== "")
    throw new Error(
      "Account bootstrap requires the existing source default role empty; no unrelated default-role change is authorized",
    );
  const reviewed = deliveryArgoPolicy()
    .split("\n")
    .filter((row) => row.trim().length > 0);
  if (reviewed.length === 0 || reviewed.some((row) => !deliveryRow(row)))
    throw new Error("Reviewed bootstrap RBAC contains an unexpected principal");
  const preserved = originalPolicy
    .split("\n")
    .filter((row) => !deliveryRow(row));
  return {
    ...source,
    helm: {
      ...source.helm,
      valuesObject: {
        ...values,
        configs: {
          ...configs,
          cm: {
            ...cm,
            ...DELIVERY_ARGO_ACCOUNTS,
            ...DELIVERY_ARGO_SERVER_SETTINGS,
          },
          rbac: {
            ...rbac,
            "policy.csv": [...preserved, ...reviewed].join("\n"),
          },
        },
      },
    },
  };
}
