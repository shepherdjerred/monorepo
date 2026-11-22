import type {
  ArgoApplication,
  PodStatus,
} from "@shepherdjerred/ops-clients/kubernetes.ts";
import type { PrometheusSample } from "@shepherdjerred/ops-clients/prometheus.ts";
import type { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import type { ClusterFacet } from "@shepherdjerred/ops-model/facets.ts";

export type WorkloadPromInputs = {
  restarts24h: readonly PrometheusSample[];
  oomKills24h: readonly PrometheusSample[];
  podImages: readonly PrometheusSample[];
  deploySpec: readonly PrometheusSample[];
  deployReady: readonly PrometheusSample[];
  stsSpec: readonly PrometheusSample[];
  stsReady: readonly PrometheusSample[];
  dsSpec?: readonly PrometheusSample[];
  dsReady?: readonly PrometheusSample[];
};

type WorkloadMaps = {
  argoByNs: Map<string, string>;
  restartsByPod: Map<string, number>;
  oomByPod: Map<string, number>;
  imageByPod: Map<string, string>;
  deployReady: Map<string, number>;
  stsReady: Map<string, number>;
  dsReady: Map<string, number>;
};

function samplePairMap(
  samples: readonly PrometheusSample[],
  firstLabel: string,
  secondLabel: string,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of samples) {
    const key = `${s.metric[firstLabel] ?? ""}/${s.metric[secondLabel] ?? ""}`;
    map.set(key, Math.round(s.value));
  }
  return map;
}

function indexTelemetry(
  argoApps: readonly ArgoApplication[],
  prom: WorkloadPromInputs,
): WorkloadMaps {
  const argoByNs = new Map<string, string>();
  for (const app of argoApps) {
    if (
      app.destinationNamespace !== undefined &&
      !argoByNs.has(app.destinationNamespace)
    ) {
      argoByNs.set(app.destinationNamespace, app.name);
    }
  }
  const imageByPod = new Map<string, string>();
  for (const s of prom.podImages) {
    const key = `${s.metric["namespace"] ?? ""}/${s.metric["pod"] ?? ""}`;
    const img = s.metric["image"] ?? "";
    if (img !== "" && !imageByPod.has(key)) {
      imageByPod.set(key, img);
    }
  }
  return {
    argoByNs,
    restartsByPod: samplePairMap(prom.restarts24h, "namespace", "pod"),
    oomByPod: samplePairMap(prom.oomKills24h, "namespace", "pod"),
    imageByPod,
    deployReady: samplePairMap(prom.deployReady, "namespace", "deployment"),
    stsReady: samplePairMap(prom.stsReady, "namespace", "statefulset"),
    dsReady: samplePairMap(prom.dsReady ?? [], "namespace", "daemonset"),
  };
}

function addControllerSamples(input: {
  samples: readonly PrometheusSample[];
  kind: "Deployment" | "StatefulSet" | "DaemonSet";
  nameLabel: string;
  readyMap: ReadonlyMap<string, number>;
  argoByNs: ReadonlyMap<string, string>;
  services: ServiceIndex;
  target: Map<string, ClusterFacet["workloads"][number]>;
  controllerSeeded: Set<string>;
}): void {
  for (const s of input.samples) {
    const namespace = s.metric["namespace"] ?? "";
    const name = s.metric[input.nameLabel] ?? "";
    if (namespace === "" || name === "") {
      continue;
    }
    const svc = input.services.byNamespace(namespace);
    const key = `${namespace}/${input.kind}/${name}`;
    input.controllerSeeded.add(key);
    input.target.set(key, {
      namespace,
      kind: input.kind,
      name,
      readyReplicas: input.readyMap.get(`${namespace}/${name}`) ?? 0,
      desiredReplicas: Math.round(s.value),
      restarts24h: 0,
      oomKills24h: 0,
      image: "",
      serviceId: svc?.id ?? null,
      argoApp: input.argoByNs.get(namespace) ?? svc?.argoApps[0] ?? null,
      retainedPool: /-wf-retained-/iu.test(name),
    });
  }
}

function inferWorkloadPrefix(
  podName: string,
  ownerKind: string | undefined,
): string {
  if (ownerKind === "StatefulSet") {
    return podName.replace(/-\d+$/u, "");
  }
  return ownerKind === "DaemonSet"
    ? podName.replace(/-[a-z0-9]{5}$/u, "")
    : podName.replace(/-[a-z0-9]{8,10}-[a-z0-9]{5}$/u, "");
}

function mergePodIntoWorkloads(input: {
  pod: PodStatus;
  maps: WorkloadMaps;
  services: ServiceIndex;
  target: Map<string, ClusterFacet["workloads"][number]>;
  controllerSeeded: ReadonlySet<string>;
}): void {
  const { pod, maps, services, target, controllerSeeded } = input;
  if (pod.ownerKind === "Job") {
    return;
  }
  const kind =
    pod.ownerKind === "ReplicaSet" ? "Deployment" : (pod.ownerKind ?? "Pod");
  const name = inferWorkloadPrefix(pod.name, pod.ownerKind);
  const key = `${pod.namespace}/${kind}/${name}`;
  const podKey = `${pod.namespace}/${pod.name}`;
  const restarts = maps.restartsByPod.get(podKey) ?? pod.restarts;
  const oom = maps.oomByPod.get(podKey) ?? 0;
  const img = maps.imageByPod.get(podKey) ?? "";
  const isHealthy = pod.phase === "Running" && pod.problem === undefined;
  const existing = target.get(key);
  if (existing !== undefined) {
    if (!controllerSeeded.has(key)) {
      existing.desiredReplicas += 1;
      if (isHealthy) {
        existing.readyReplicas += 1;
      }
    }
    existing.restarts24h += restarts;
    existing.oomKills24h += oom;
    if (img !== "" && existing.image === "") {
      existing.image = img;
    }
    return;
  }
  const svc = services.byNamespace(pod.namespace);
  target.set(key, {
    namespace: pod.namespace,
    kind,
    name,
    readyReplicas: isHealthy ? 1 : 0,
    desiredReplicas: 1,
    restarts24h: restarts,
    oomKills24h: oom,
    image: img,
    serviceId: svc?.id ?? null,
    argoApp: maps.argoByNs.get(pod.namespace) ?? svc?.argoApps[0] ?? null,
    retainedPool: /-wf-retained-/iu.test(name),
  });
}

export function buildWorkloads(input: {
  pods: readonly PodStatus[];
  argoApps: readonly ArgoApplication[];
  prom: WorkloadPromInputs;
  services: ServiceIndex;
}): {
  workloadSummary: ClusterFacet["workloadSummary"];
  workloads: ClusterFacet["workloads"];
} {
  const maps = indexTelemetry(input.argoApps, input.prom);
  const workloadsMap = new Map<string, ClusterFacet["workloads"][number]>();
  const controllerSeeded = new Set<string>();

  addControllerSamples({
    samples: input.prom.deploySpec,
    kind: "Deployment",
    nameLabel: "deployment",
    readyMap: maps.deployReady,
    argoByNs: maps.argoByNs,
    services: input.services,
    target: workloadsMap,
    controllerSeeded,
  });
  addControllerSamples({
    samples: input.prom.stsSpec,
    kind: "StatefulSet",
    nameLabel: "statefulset",
    readyMap: maps.stsReady,
    argoByNs: maps.argoByNs,
    services: input.services,
    target: workloadsMap,
    controllerSeeded,
  });
  addControllerSamples({
    samples: input.prom.dsSpec ?? [],
    kind: "DaemonSet",
    nameLabel: "daemonset",
    readyMap: maps.dsReady,
    argoByNs: maps.argoByNs,
    services: input.services,
    target: workloadsMap,
    controllerSeeded,
  });

  for (const pod of input.pods) {
    mergePodIntoWorkloads({
      pod,
      maps,
      services: input.services,
      target: workloadsMap,
      controllerSeeded,
    });
  }

  const workloads = [...workloadsMap.values()].sort(
    (a, b) =>
      a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name),
  );
  let healthy = 0;
  let degraded = 0;
  let retainedPools = 0;
  for (const w of workloads) {
    if (w.retainedPool) {
      retainedPools += 1;
    }
    if (w.readyReplicas >= w.desiredReplicas) {
      healthy += 1;
    } else {
      degraded += 1;
    }
  }

  return {
    workloadSummary: {
      total: workloads.length,
      healthy,
      degraded,
      retainedPools,
    },
    workloads,
  };
}
