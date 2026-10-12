/**
 * Pod label the postgres-operator stamps with each cluster's name (its
 * `cluster_name_label` setting). NetworkPolicies select database pods by it.
 */
export const POSTGRES_CLUSTER_NAME_LABEL = "cluster-name";

export function postgresClusterPodLabels(
  clusterName: string,
): Record<string, string> {
  return { [POSTGRES_CLUSTER_NAME_LABEL]: clusterName };
}
