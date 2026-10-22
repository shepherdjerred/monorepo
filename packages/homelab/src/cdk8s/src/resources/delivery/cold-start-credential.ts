import type { Chart } from "cdk8s";
import { EnvValue, Secret } from "cdk8s-plus-31";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { HOMELAB_R2_ITEM_ID } from "@shepherdjerred/homelab/cdk8s/src/resources/argo-applications/storage/velero.ts";

/**
 * The homelab R2 bucket's credential (Velero's item) as environment.
 * Delivery's cold-start snapshot lives in that bucket under
 * `delivery-cold-start/` (model section 6): the backup worker
 * writes the snapshot and the Delivery API reads it for
 * reconcile-after-restore. `name` is the synced Secret's name.
 */
export function deliveryColdStartEnvironment(
  chart: Chart,
  name: string,
): Record<string, EnvValue> {
  const item = new OnePasswordItem(chart, name, {
    metadata: { name },
    spec: { itemPath: vaultItemPath(HOMELAB_R2_ITEM_ID) },
  });
  const secret = Secret.fromSecretName(chart, `${name}-secret`, item.name);
  return Object.fromEntries(
    ["CLOUDFLARE_R2_ACCESS_KEY_ID", "CLOUDFLARE_R2_SECRET_ACCESS_KEY"].map(
      (key) => [key, EnvValue.fromSecretValue({ secret, key })],
    ),
  );
}
