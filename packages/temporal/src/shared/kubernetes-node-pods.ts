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
    requireExactlyOneReadyPodPerNode?: boolean;
  },
): KubernetesNodePod[] {
  const nodePods = new Map<string, string>();
  const candidateCountsByNode = new Map<string, number>();
  const requireExactlyOneReadyPodPerNode =
    context.requireExactlyOneReadyPodPerNode === true;
  for (const pod of pods) {
    const node = pod.spec?.nodeName;
    validateNodeIdentity(node, context, requireExactlyOneReadyPodPerNode);
    if (node !== undefined) {
      candidateCountsByNode.set(
        node,
        (candidateCountsByNode.get(node) ?? 0) + 1,
      );
    }

    if (!isRunningReady(pod)) {
      continue;
    }

    if (node === undefined) {
      throw new Error(
        `Running and Ready ${context.resourceDescription} pod is missing metadata.name or spec.nodeName`,
      );
    }
    const name = getReadyPodName(pod, context);

    const existingPod = nodePods.get(node);
    if (existingPod !== undefined) {
      throw new Error(
        `Multiple Running and Ready ${context.resourceDescription} pods found for node ${node}: ` +
          `${existingPod}, ${name}`,
      );
    }
    nodePods.set(node, name);
  }

  if (nodePods.size === 0) {
    throw new Error(
      `No Running and Ready ${context.resourceDescription} pods found in ${context.namespace} ` +
        `(label selector: ${context.labelSelector})`,
    );
  }

  if (requireExactlyOneReadyPodPerNode) {
    validateExactlyOneReadyPodPerNode(
      candidateCountsByNode,
      nodePods,
      context.resourceDescription,
    );
  }

  return [...nodePods.entries()]
    .map(([node, pod]) => ({ node, pod }))
    .toSorted((left, right) => left.node.localeCompare(right.node));
}

function validateNodeIdentity(
  node: string | undefined,
  context: { resourceDescription: string },
  requireNode: boolean,
): void {
  if (node === undefined && requireNode) {
    throw new Error(
      `Running and Ready ${context.resourceDescription} pod is missing metadata.name or spec.nodeName`,
    );
  }
}

function isRunningReady(pod: KubernetesNodePodCandidate): boolean {
  return (
    pod.status?.phase === "Running" &&
    pod.status.conditions?.some(
      (condition) => condition.type === "Ready" && condition.status === "True",
    ) === true
  );
}

function getReadyPodName(
  pod: KubernetesNodePodCandidate,
  context: { resourceDescription: string },
): string {
  const name = pod.metadata?.name;
  if (name === undefined) {
    throw new Error(
      `Running and Ready ${context.resourceDescription} pod is missing metadata.name or spec.nodeName`,
    );
  }
  return name;
}

function validateExactlyOneReadyPodPerNode(
  candidateCountsByNode: ReadonlyMap<string, number>,
  nodePods: ReadonlyMap<string, string>,
  resourceDescription: string,
): void {
  for (const [node, candidateCount] of candidateCountsByNode) {
    if (candidateCount !== 1 || !nodePods.has(node)) {
      const readyState = nodePods.has(node) ? "one Ready pod" : "no Ready pod";
      throw new Error(
        `Expected exactly one Running and Ready ${resourceDescription} pod for node ${node}; ` +
          `found ${String(candidateCount)} candidate(s) and ${readyState}`,
      );
    }
  }
}
