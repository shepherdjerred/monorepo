import type { Chart } from "cdk8s";
import { type ISecret, Secret } from "cdk8s-plus-31";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { singleAppDatabase } from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/postgres-database.ts";
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
  const database = singleAppDatabase(chart, {
    app: "media",
    provision: true,
    userFlags: [],
  });
  const item = new OnePasswordItem(chart, "media-config", {
    spec: { itemPath: vaultItemPath("rmutlb6qv2h7pkasbhpxbpdhie") },
  });
  const bootstrap = Secret.fromSecretName(
    chart,
    "media-application-bootstrap",
    item.name,
  );
  const discord = Secret.fromSecretName(
    chart,
    "media-application-discord",
    "media-streambot-config",
  );
  const mailItem = new OnePasswordItem(chart, "media-mail", {
    spec: { itemPath: vaultItemPath("media-mail") },
  });
  const mail = Secret.fromSecretName(
    chart,
    "media-application-mail",
    mailItem.name,
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
    discord,
    plexServiceName: props.plex.serviceName,
  });
  const workers = createMediaActivityWorkers(chart, {
    database,
    bootstrap,
    discord,
    mail,
    qbittorrent,
    claims: props.claims,
    plex: props.plex,
  });
  createMediaApplicationNetworkPolicies(chart, database);
  return { api, ...workers };
}
