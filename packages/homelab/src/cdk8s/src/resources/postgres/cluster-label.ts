/**
 * Pod label the postgres-operator stamps with each cluster's name (its
 * `cluster_name_label` setting). NetworkPolicies select database pods by it.
 */
export const POSTGRES_CLUSTER_NAME_LABEL = "cluster-name";

/**
 * Labels the postgres-operator stamps on every cluster's pods (its
 * `cluster_labels` setting).
 */
export const POSTGRES_OPERATOR_CLUSTER_LABELS = {
  application: "spilo",
} as const;

export function postgresClusterPodLabels(
  clusterName: string,
): Record<string, string> {
  return { [POSTGRES_CLUSTER_NAME_LABEL]: clusterName };
}
