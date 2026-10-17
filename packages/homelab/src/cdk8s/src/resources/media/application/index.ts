import type { Chart } from "cdk8s";
import { type ISecret, Secret } from "cdk8s-plus-31";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { createSingleAppPostgreSQL } from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/single-app-postgresql.ts";
import { createMediaApi } from "./api.ts";
import {
  createMediaActivityWorkers,
  type MediaApplicationClaims,
} from "./workers.ts";
import { createMediaApplicationNetworkPolicies } from "./network-policy.ts";

/** Parallel installation. Existing media services and hostnames remain owned by their current resources. */
export function createUnifiedMediaApplication(
  chart: Chart,
  props: {
    image: string;
    claims: MediaApplicationClaims;
    plex: { serviceName: string; tokenSecret: ISecret };
  },
) {
  createSingleAppPostgreSQL(chart, { app: "media", userFlags: [] });
  const database = Secret.fromSecretName(
    chart,
    "media-application-pg",
    "media.media-postgresql.credentials.postgresql.acid.zalan.do",
  );
  const item = new OnePasswordItem(chart, "media-config", {
    spec: { itemPath: vaultItemPath("rmutlb6qv2h7pkasbhpxbpdhie") },
  });
  const bootstrap = Secret.fromSecretName(
    chart,
    "media-application-bootstrap",
    item.name,
  );
  const postalItem = new OnePasswordItem(chart, "media-postal", {
    spec: { itemPath: vaultItemPath("sx4zk4gmjf6hgjophwzwhss5je") },
  });
  const postal = Secret.fromSecretName(
    chart,
    "media-application-postal",
    postalItem.name,
  );
  const qbittorrent = Secret.fromSecretName(
    chart,
    "media-application-qbit",
    "media-qbittorrent-item",
  );
  const api = createMediaApi(chart, {
    image: props.image,
    database,
    bootstrap,
  });
  const workers = createMediaActivityWorkers(chart, {
    database,
    bootstrap,
    postal,
    qbittorrent,
    claims: props.claims,
    plex: props.plex,
  });
  createMediaApplicationNetworkPolicies(chart);
  return { api, ...workers };
}
