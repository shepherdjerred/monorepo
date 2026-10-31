import type { Chart } from "cdk8s";
import type { ServiceAccount } from "cdk8s-plus-31";
import {
  KubeRole,
  KubeRoleBinding,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";

const NAME = "delivery-players-offline";

/**
 * The players-offline step asks The Storm's console who is connected before
 * a release restarts it. The public Query feed omits hidden staff, so the
 * step runs `rcon-cli list` in the one server pod. The worker already syncs
 * that server's Application, so the grant adds a reading, not authority over
 * what runs.
 */
export function createPlayersOfflineGrant(
  chart: Chart,
  account: ServiceAccount,
): void {
  const role = new KubeRole(chart, `${NAME}-role`, {
    metadata: { name: NAME, namespace: "minecraft-tsmc" },
    rules: [
      {
        apiGroups: [""],
        resources: ["pods"],
        resourceNames: ["minecraft-tsmc-0"],
        verbs: ["get"],
      },
      {
        apiGroups: [""],
        resources: ["pods/exec"],
        resourceNames: ["minecraft-tsmc-0"],
        verbs: ["create"],
      },
    ],
  });
  new KubeRoleBinding(chart, `${NAME}-binding`, {
    metadata: { name: NAME, namespace: "minecraft-tsmc" },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "Role",
      name: role.name,
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: account.name,
        namespace: chart.namespace,
      },
    ],
  });
}
