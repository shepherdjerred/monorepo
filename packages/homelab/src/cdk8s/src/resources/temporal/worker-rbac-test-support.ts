import { App, Chart } from "cdk8s";
import { ServiceAccount } from "cdk8s-plus-31";
import { z } from "zod";

const ManifestSchema = z
  .object({
    kind: z.string(),
    metadata: z.object({ name: z.string(), namespace: z.string() }).loose(),
  })
  .loose();
const RoleSchema = z.object({
  rules: z.array(
    z.object({
      apiGroups: z.array(z.string()),
      resources: z.array(z.string()),
      resourceNames: z.array(z.string()).optional(),
      verbs: z.array(z.string()),
    }),
  ),
});
const BindingSchema = z.object({
  roleRef: z.object({ kind: z.string(), name: z.string() }),
  subjects: z.array(
    z.object({ kind: z.string(), name: z.string(), namespace: z.string() }),
  ),
});

/**
 * Grants a Role to the infra worker's service account in a temporal chart and
 * returns the synthesized Role and RoleBinding.
 */
export function renderInfraWorkerRole(
  create: (chart: Chart, accounts: ServiceAccount[]) => void,
) {
  const app = new App();
  const chart = new Chart(app, "temporal", { namespace: "temporal" });
  const infra = new ServiceAccount(chart, "infra", {
    metadata: { name: "temporal-infra-worker" },
  });
  create(chart, [infra]);
  const manifests = app.charts
    .flatMap((synthesized): unknown[] => synthesized.toJson())
    .map((manifest: unknown) => ManifestSchema.parse(manifest));
  const role = manifests.find((manifest) => manifest.kind === "Role");
  const binding = manifests.find((manifest) => manifest.kind === "RoleBinding");
  if (role === undefined || binding === undefined)
    throw new Error("Expected a Role and a RoleBinding");
  return {
    role: role.metadata,
    rules: RoleSchema.parse(role).rules,
    binding: { ...BindingSchema.parse(binding), metadata: binding.metadata },
  };
}

export const INFRA_WORKER_SUBJECT = {
  kind: "ServiceAccount",
  name: "temporal-infra-worker",
  namespace: "temporal",
};
