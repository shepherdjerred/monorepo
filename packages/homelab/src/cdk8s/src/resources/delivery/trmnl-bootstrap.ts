import type { Chart } from "cdk8s";
import { EnvValue, Secret } from "cdk8s-plus-31";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import type { DeliveryActivation } from "./activation.ts";

/** Observer code uses GET; the upstream API key itself also permits plugin writes. */
export function deliveryTrmnlEnvironment(
  chart: Chart,
  activation: DeliveryActivation,
): Record<string, EnvValue> {
  const readerId = activation.trmnlArchiveReaderItemId,
    keyId = activation.trmnlKeyItemId;
  if (readerId === undefined && keyId === undefined) return {};
  if (readerId === undefined || keyId === undefined)
    throw new Error(
      "TRMNL configuration requires both fixed archive reader and API key registrations",
    );
  const archive = new OnePasswordItem(chart, "trmnl-archive-reader", {
    spec: { itemPath: vaultItemPath(readerId) },
  });
  const plugins = new OnePasswordItem(chart, "trmnl-plugin-key", {
    spec: { itemPath: vaultItemPath(keyId) },
  });
  const archiveSecret = Secret.fromSecretName(
      chart,
      "trmnl-archive-secret",
      archive.name,
    ),
    pluginSecret = Secret.fromSecretName(
      chart,
      "trmnl-plugin-secret",
      plugins.name,
    );
  return {
    DELIVERY_TRMNL_S3_ACCESS_KEY_ID: EnvValue.fromSecretValue({
      secret: archiveSecret,
      key: "DELIVERY_TRMNL_S3_ACCESS_KEY_ID",
    }),
    DELIVERY_TRMNL_S3_SECRET_ACCESS_KEY: EnvValue.fromSecretValue({
      secret: archiveSecret,
      key: "DELIVERY_TRMNL_S3_SECRET_ACCESS_KEY",
    }),
    TRMNL_API_KEY: EnvValue.fromSecretValue({
      secret: pluginSecret,
      key: "TRMNL_API_KEY",
    }),
  };
}
