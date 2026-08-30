import type {
  LegacyTemporalNamespace,
  TemporalNamespace,
} from "./temporal-namespace.ts";
import type { WorkerRole } from "./worker-role.ts";

export function assertCentralWorkerNamespace(
  role: WorkerRole,
  namespace: TemporalNamespace,
): void {
  const expected = role === "all" ? "dev" : "prod";
  if (namespace !== expected) {
    throw new Error(
      `Temporal worker role ${role} requires namespace ${expected}, received ${namespace}`,
    );
  }
}

export function workerNamespaces(input: {
  queueRole: WorkerRole;
  activeNamespace: TemporalNamespace;
  legacyNamespace: LegacyTemporalNamespace | undefined;
}): readonly (TemporalNamespace | LegacyTemporalNamespace)[] {
  if (input.queueRole === "legacy") {
    const namespaces: (TemporalNamespace | LegacyTemporalNamespace)[] = [
      input.activeNamespace,
    ];
    if (input.legacyNamespace !== undefined) {
      namespaces.push(input.legacyNamespace);
    }
    return namespaces;
  }
  const activeNamespaces: readonly TemporalNamespace[] =
    (input.queueRole === "scout" || input.queueRole === "workflows") &&
    input.activeNamespace === "prod"
      ? ["prod", "beta"]
      : [input.activeNamespace];
  return input.legacyNamespace === undefined
    ? activeNamespaces
    : [...activeNamespaces, input.legacyNamespace];
}
