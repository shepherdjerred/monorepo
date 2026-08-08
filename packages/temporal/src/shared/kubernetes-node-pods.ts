export type KubernetesNodePod = {
  node: string;
  pod: string;
};

export type KubernetesNodePodCandidate = {
  metadata?: {
    name?: string;
  };
  spec?: {
    nodeName?: string;
  };
  status?: {
    phase?: string;
    conditions?: {
      type?: string;
      status?: string;
    }[];
  };
};

export function selectRunningReadyNodePods(
  pods: readonly KubernetesNodePodCandidate[],
  context: {
    namespace: string;
    labelSelector: string;
    resourceDescription: string;
  },
): KubernetesNodePod[] {
  const nodePods = new Map<string, string>();
  for (const pod of pods) {
    const isReady = pod.status?.conditions?.some(
      (condition) => condition.type === "Ready" && condition.status === "True",
    );
    if (isReady !== true || pod.status?.phase !== "Running") {
      continue;
    }

    const name = pod.metadata?.name;
    const node = pod.spec?.nodeName;
    if (name === undefined || node === undefined) {
      throw new Error(
        `Running and Ready ${context.resourceDescription} pod is missing metadata.name or spec.nodeName`,
      );
    }

    const existingPod = nodePods.get(node);
    if (existingPod !== undefined) {
      throw new Error(
        `Multiple Running and Ready ${context.resourceDescription} pods found for node ${node}: ${existingPod}, ${name}`,
      );
    }
    nodePods.set(node, name);
  }

  if (nodePods.size === 0) {
    throw new Error(
      `No Running and Ready ${context.resourceDescription} pods found in ${context.namespace} (label selector: ${context.labelSelector})`,
    );
  }

  return [...nodePods.entries()]
    .map(([node, pod]) => ({ node, pod }))
    .toSorted((left, right) => left.node.localeCompare(right.node));
}
