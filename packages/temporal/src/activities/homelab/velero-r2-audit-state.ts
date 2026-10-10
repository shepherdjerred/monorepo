import { CoreV1Api, KubeConfig, V1ConfigMap } from "@kubernetes/client-node";
import { z } from "zod";
import {
  veleroOrphanR2BytesTotal,
  veleroOrphanR2PrefixesTotal,
  veleroR2AuditObservationTimestampSeconds,
  veleroR2IncompleteChainRoots,
} from "#observability/metrics.ts";

const NAME = "velero-r2-orphan-audit-state";
const NAMESPACE = "temporal";
const KEY = "audit.json";
export const VeleroR2AuditStateSchema = z.object({
  version: z.literal(1),
  bucket: z.string().min(1),
  observedAt: z.number().positive(),
  orphanPrefixCount: z.number().int().nonnegative(),
  orphanBytes: z.number().int().nonnegative(),
  incompleteChainCount: z.number().int().nonnegative(),
});
type State = z.infer<typeof VeleroR2AuditStateSchema>;
export type AuditStateStore = {
  read: () => Promise<V1ConfigMap>;
  replace: (value: V1ConfigMap) => Promise<void>;
};
function store(): AuditStateStore {
  const config = new KubeConfig();
  config.loadFromDefault();
  const api = config.makeApiClient(CoreV1Api);
  return {
    read: () =>
      api.readNamespacedConfigMap({ name: NAME, namespace: NAMESPACE }),
    replace: async (body) => {
      await api.replaceNamespacedConfigMap({
        name: NAME,
        namespace: NAMESPACE,
        body,
      });
    },
  };
}
function stateFromConfigMap(value: V1ConfigMap): State | undefined {
  const json = value.data?.[KEY];
  // Only the explicitly empty, newly provisioned ConfigMap has no observation.
  return json === undefined
    ? undefined
    : VeleroR2AuditStateSchema.parse(JSON.parse(json));
}
export function recordVeleroR2AuditState(state: State): void {
  const labels = { bucket: state.bucket };
  veleroOrphanR2PrefixesTotal.set(labels, state.orphanPrefixCount);
  veleroOrphanR2BytesTotal.set(labels, state.orphanBytes);
  veleroR2AuditObservationTimestampSeconds.set(labels, state.observedAt);
  veleroR2IncompleteChainRoots.set(labels, state.incompleteChainCount);
}
export async function restoreVeleroR2AuditMetrics(
  stateStore = store(),
): Promise<void> {
  const state = stateFromConfigMap(await stateStore.read());
  if (state !== undefined) recordVeleroR2AuditState(state);
}
export async function publishVeleroR2AuditState(
  state: State,
  stateStore = store(),
): Promise<State> {
  VeleroR2AuditStateSchema.parse(state);
  for (let attempt = 0; attempt < 5; attempt++) {
    const configMap = await stateStore.read();
    const previous = stateFromConfigMap(configMap);
    if (previous !== undefined && previous.observedAt >= state.observedAt)
      return previous;
    if (configMap.metadata?.resourceVersion === undefined)
      throw new Error("Audit state ConfigMap omitted resourceVersion");
    try {
      await stateStore.replace(
        Object.assign(new V1ConfigMap(), configMap, {
          data: { ...configMap.data, [KEY]: JSON.stringify(state) },
        }),
      );
      return state;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== 409)
        throw error;
    }
  }
  throw new Error("Audit state publication repeatedly conflicted");
}
