import type { Chart } from "cdk8s";
import { EnvValue, Secret } from "cdk8s-plus-31";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import type { DeliveryActivation } from "./activation.ts";

/** Capability registration is optional; every enabled credential reference is required. */
export function deliveryForumEnvironment(
  chart: Chart,
  activation: DeliveryActivation,
): Record<string, EnvValue> {
  const reader = activation.forumReaderItemId,
    observer = activation.forumObserverItemId;
  if (reader === undefined && observer === undefined) return {};
  if (reader === undefined || observer === undefined)
    throw new Error(
      "Forum requires its dedicated reader and observer registrations together",
    );
  const readerItem = new OnePasswordItem(chart, "forum-reader", {
    spec: { itemPath: vaultItemPath(reader) },
  });
  const observerItem = new OnePasswordItem(chart, "forum-observer", {
    spec: { itemPath: vaultItemPath(observer) },
  });
  const readerSecret = Secret.fromSecretName(
    chart,
    "forum-reader-secret",
    readerItem.name,
  );
  const observerSecret = Secret.fromSecretName(
    chart,
    "forum-observer-secret",
    observerItem.name,
  );
  return {
    DELIVERY_FORUM_S3_ACCESS_KEY_ID: EnvValue.fromSecretValue({
      secret: readerSecret,
      key: "DELIVERY_FORUM_S3_ACCESS_KEY_ID",
    }),
    DELIVERY_FORUM_S3_SECRET_ACCESS_KEY: EnvValue.fromSecretValue({
      secret: readerSecret,
      key: "DELIVERY_FORUM_S3_SECRET_ACCESS_KEY",
    }),
    DELIVERY_FORUM_OBSERVATION_TOKEN: EnvValue.fromSecretValue({
      secret: observerSecret,
      key: "DELIVERY_FORUM_OBSERVATION_TOKEN",
    }),
  };
}
