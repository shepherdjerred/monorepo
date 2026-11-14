import { BRIM_SYNC_CREDENTIALS } from "#lib/brim/sync/credential-specs.ts";
import { LIVE_TOKEN_OP_REF } from "@shepherdjerred/mc-harness/protocol/live.ts";

/**
 * Every credential toolkit can broker, by the variable name it is exposed as.
 * Each entry names exactly one backend; `credentials.ts` resolves them.
 */

export type CredentialSource =
  | { readonly kind: "keychain"; readonly service: string }
  | { readonly kind: "op"; readonly ref: string };

export type CredentialSpec = {
  readonly description: string;
  readonly source: CredentialSource;
};

export const PRIVATE_VAULT_REF = "op://63lcesgoblzbpkdr4koye66rei";
const HOMELAB_VAULT_REF = "op://v64ocnykdqju4ui6j6pua56xw4";
const HOMELAB_ADMIN_VAULT_REF = "op://yx6je6mgj2oiss6z5bm42h3cxy";
const KUBECONFIG_ITEM_ID = "qbowip7zr7cggo5p5tam7g6rxe";
const TALOSCONFIG_ITEM_ID = "qtgyg6nwvbcfzu73w4ojmmr2ta";
const SEAWEEDFS_S3_ITEM_ID = "vet52jaeh75chsalu6lulugium";
const BACKBLAZE_VELERO_ITEM_ID = "i3upt4mhwczcau7ojyxfpw2s6e";
const BACKBLAZE_POSTGRES_WAL_ITEM_ID = "ydap5smx2eirpq73oklmhkzxfm";
const BACKBLAZE_SEAWEEDFS_BACKUPS_ITEM_ID = "q3t3h5dkrqwtbllgybca7pjvke";
const BUGSINK_ITEM = "jeuqmwh3r4nwu2ivo4pa3gr7om";
const WOODPECKER_ITEM = "covttsojandjk7fx62a3dbk7em";
const DELIVERY_SERVICE_ITEM_ID = "ahbp4izt7fibvwdjwd4ffhiime";
const DELIVERY_TRMNL_READER_ITEM_ID = "542onhpijguqgaukmyvbujbu74";
const DELIVERY_TRMNL_ACCOUNT_ITEM_ID = "p7th6tqeel7k2sm47mrrto7oca";
const DELIVERY_SITE_ACTIVATOR_ITEM_ID = "l5c76kuxgqckt3xc7pmman6l4u";
const DELIVERY_CACHE_PURGE_ITEM_ID = "la7gkfl5eqtxiiv2hq3qujx2gi";
const SCOUT_BETA_ITEM_ID = "rtu44pohnp5ixdp2njuv5f6t2e";
const SCOUT_PROD_ITEM_ID = "pacrc4wfbtct4y3qazkvazop5a";

export const CREDENTIAL_REGISTRY: Record<string, CredentialSpec> = {
  MC_BRIDGE_TOKEN: {
    description: "Authenticated Minecraft operator bridge",
    source: { kind: "op", ref: LIVE_TOKEN_OP_REF },
  },
  DELIVERY_SITE_ACTIVATOR_ACCESS_KEY_ID: {
    description: "Delivery static-site activator access key",
    source: {
      kind: "op",
      ref: `${HOMELAB_VAULT_REF}/${DELIVERY_SITE_ACTIVATOR_ITEM_ID}/DELIVERY_SITE_ACTIVATOR_ACCESS_KEY_ID`,
    },
  },
  DELIVERY_SITE_ACTIVATOR_SECRET_ACCESS_KEY: {
    description: "Delivery static-site activator secret key",
    source: {
      kind: "op",
      ref: `${HOMELAB_VAULT_REF}/${DELIVERY_SITE_ACTIVATOR_ITEM_ID}/DELIVERY_SITE_ACTIVATOR_SECRET_ACCESS_KEY`,
    },
  },
  CLOUDFLARE_API_TOKEN: {
    description: "Delivery six-zone cache-purge token",
    source: {
      kind: "op",
      ref: `${HOMELAB_VAULT_REF}/${DELIVERY_CACHE_PURGE_ITEM_ID}/credential`,
    },
  },
  TRMNL_API_KEY: {
    description: "Fixed TRMNL plugin configuration key (read/write authority)",
    source: {
      kind: "op",
      ref: `${HOMELAB_VAULT_REF}/${DELIVERY_TRMNL_ACCOUNT_ITEM_ID}/TRMNL_API_KEY`,
    },
  },
  DELIVERY_TRMNL_S3_ACCESS_KEY_ID: {
    description: "Read-only Delivery TRMNL archive access key",
    source: {
      kind: "op",
      ref: `${HOMELAB_VAULT_REF}/${DELIVERY_TRMNL_READER_ITEM_ID}/DELIVERY_TRMNL_S3_ACCESS_KEY_ID`,
    },
  },
  DELIVERY_TRMNL_S3_SECRET_ACCESS_KEY: {
    description: "Read-only Delivery TRMNL archive secret key",
    source: {
      kind: "op",
      ref: `${HOMELAB_VAULT_REF}/${DELIVERY_TRMNL_READER_ITEM_ID}/DELIVERY_TRMNL_S3_SECRET_ACCESS_KEY`,
    },
  },
  DELIVERY_PUBLISHER_TOKEN: {
    description:
      "Delivery publisher token for immutable licensed archive descriptors",
    source: {
      kind: "op",
      ref: `${HOMELAB_VAULT_REF}/${DELIVERY_SERVICE_ITEM_ID}/DELIVERY_PUBLISHER_TOKEN`,
    },
  },
  DELIVERY_EXECUTOR_TOKEN: {
    description:
      "Delivery scoped executor token for independent recovery proof completion",
    source: {
      kind: "op",
      ref: `${HOMELAB_VAULT_REF}/${DELIVERY_SERVICE_ITEM_ID}/DELIVERY_EXECUTOR_TOKEN`,
    },
  },
  DELIVERY_ATTEST_TOKEN: {
    description:
      "Delivery operator attestation token (attest scope only; never an executor credential)",
    source: {
      kind: "op",
      ref: `${HOMELAB_VAULT_REF}/${DELIVERY_SERVICE_ITEM_ID}/DELIVERY_ATTEST_TOKEN`,
    },
  },
  DELIVERY_API_TOKEN: {
    description:
      "Delivery machine API token (cannot approve production releases)",
    source: {
      kind: "op",
      ref: `${HOMELAB_VAULT_REF}/${DELIVERY_SERVICE_ITEM_ID}/DELIVERY_ADMIN_TOKEN`,
    },
  },
  SCOUT_OPERATIONS_TOKEN_BETA: {
    description:
      "Scout beta operations machine token (acts as its Git-bound operator)",
    source: {
      kind: "op",
      ref: `${HOMELAB_VAULT_REF}/${SCOUT_BETA_ITEM_ID}/SCOUT_OPERATIONS_TOKEN`,
    },
  },
  SCOUT_OPERATIONS_TOKEN_PROD: {
    description:
      "Scout production operations machine token (acts as its Git-bound operator)",
    source: {
      kind: "op",
      ref: `${HOMELAB_VAULT_REF}/${SCOUT_PROD_ITEM_ID}/SCOUT_OPERATIONS_TOKEN`,
    },
  },
  GRAFANA_API_KEY: {
    description: "Grafana API key",
    source: {
      kind: "op",
      ref: "op://v64ocnykdqju4ui6j6pua56xw4/w5y6wldczvojkh3yxe5zadkpvi/password",
    },
  },
  POSTHOG_CLI_API_KEY: {
    description: "PostHog CLI API key",
    source: {
      kind: "op",
      ref: "op://v64ocnykdqju4ui6j6pua56xw4/yh3xvqemmr4ic2up5zluo2rkcq/m7vvkd6ymu6pqk32zm7kqfynve",
    },
  },
  CF_API_TOKEN: {
    description: "Cloudflare API token",
    source: {
      kind: "op",
      ref: "op://v64ocnykdqju4ui6j6pua56xw4/vp4l6tpe2cly6q4w5aremgvnbe/credential",
    },
  },
  ARGOCD_AUTH_TOKEN: {
    description:
      "ArgoCD read-only workstation API token (minted by the argocd OpenTofu stack)",
    source: {
      kind: "op",
      ref: `${HOMELAB_VAULT_REF}/argocd-workstation-token/tokens/ARGOCD_AUTH_TOKEN`,
    },
  },
  DISCORD_USER_TOKEN: {
    description: "Discord user token",
    source: {
      kind: "keychain",
      service: "monorepo-workstation-discord-user-token",
    },
  },
  DISCORD_BOT_TOKEN: {
    description: "Discord bot token",
    source: {
      kind: "keychain",
      service: "monorepo-workstation-discord-bot-token",
    },
  },
  BUGSINK_TOKEN: {
    description: "Bugsink API token",
    source: {
      kind: "op",
      ref: `${HOMELAB_VAULT_REF}/${BUGSINK_ITEM}/BUGSINK_TOKEN`,
    },
  },
  KUBE_CLIENT_CERTIFICATE_DATA: {
    description: "Kubernetes admin client certificate (base64 PEM)",
    source: {
      kind: "op",
      ref: `${HOMELAB_ADMIN_VAULT_REF}/${KUBECONFIG_ITEM_ID}/client-certificate-data`,
    },
  },
  KUBE_CLIENT_KEY_DATA: {
    description: "Kubernetes admin client key (base64 PEM)",
    source: {
      kind: "op",
      ref: `${HOMELAB_ADMIN_VAULT_REF}/${KUBECONFIG_ITEM_ID}/client-key-data`,
    },
  },
  TALOS_CA: {
    description: "Talos API CA certificate (base64 PEM)",
    source: {
      kind: "op",
      ref: `${HOMELAB_VAULT_REF}/${TALOSCONFIG_ITEM_ID}/ca`,
    },
  },
  TALOS_CRT: {
    description: "Talos os:admin client certificate (base64 PEM)",
    source: {
      kind: "op",
      ref: `${HOMELAB_VAULT_REF}/${TALOSCONFIG_ITEM_ID}/crt`,
    },
  },
  TALOS_KEY: {
    description: "Talos os:admin client key (base64 PEM)",
    source: {
      kind: "op",
      ref: `${HOMELAB_VAULT_REF}/${TALOSCONFIG_ITEM_ID}/key`,
    },
  },
  SEAWEEDFS_S3_ACCESS_KEY_ID: {
    description: "SeaweedFS S3 admin access key (aws profile seaweedfs)",
    source: {
      kind: "op",
      ref: `${HOMELAB_VAULT_REF}/${SEAWEEDFS_S3_ITEM_ID}/SEAWEEDFS_ACCESS_KEY_ID`,
    },
  },
  SEAWEEDFS_S3_SECRET_ACCESS_KEY: {
    description: "SeaweedFS S3 admin secret key (aws profile seaweedfs)",
    source: {
      kind: "op",
      ref: `${HOMELAB_VAULT_REF}/${SEAWEEDFS_S3_ITEM_ID}/SEAWEEDFS_SECRET_ACCESS_KEY`,
    },
  },
  B2_VELERO_ACCESS_KEY_ID: {
    description: "Backblaze B2 Velero bucket key ID (aws profile b2-velero)",
    source: {
      kind: "op",
      ref: `${HOMELAB_VAULT_REF}/${BACKBLAZE_VELERO_ITEM_ID}/B2_ACCESS_KEY_ID`,
    },
  },
  B2_VELERO_SECRET_ACCESS_KEY: {
    description: "Backblaze B2 Velero bucket secret (aws profile b2-velero)",
    source: {
      kind: "op",
      ref: `${HOMELAB_VAULT_REF}/${BACKBLAZE_VELERO_ITEM_ID}/B2_SECRET_ACCESS_KEY`,
    },
  },
  B2_POSTGRES_WAL_ACCESS_KEY_ID: {
    description:
      "Backblaze B2 Postgres WAL bucket key ID (aws profile b2-postgres-wal)",
    source: {
      kind: "op",
      ref: `${HOMELAB_VAULT_REF}/${BACKBLAZE_POSTGRES_WAL_ITEM_ID}/B2_ACCESS_KEY_ID`,
    },
  },
  B2_POSTGRES_WAL_SECRET_ACCESS_KEY: {
    description:
      "Backblaze B2 Postgres WAL bucket secret (aws profile b2-postgres-wal)",
    source: {
      kind: "op",
      ref: `${HOMELAB_VAULT_REF}/${BACKBLAZE_POSTGRES_WAL_ITEM_ID}/B2_SECRET_ACCESS_KEY`,
    },
  },
  B2_SEAWEEDFS_BACKUPS_ACCESS_KEY_ID: {
    description:
      "Backblaze B2 SeaweedFS backup bucket key ID (aws profile b2-seaweedfs-backups)",
    source: {
      kind: "op",
      ref: `${HOMELAB_VAULT_REF}/${BACKBLAZE_SEAWEEDFS_BACKUPS_ITEM_ID}/B2_ACCESS_KEY_ID`,
    },
  },
  B2_SEAWEEDFS_BACKUPS_SECRET_ACCESS_KEY: {
    description:
      "Backblaze B2 SeaweedFS backup bucket secret (aws profile b2-seaweedfs-backups)",
    source: {
      kind: "op",
      ref: `${HOMELAB_VAULT_REF}/${BACKBLAZE_SEAWEEDFS_BACKUPS_ITEM_ID}/B2_SECRET_ACCESS_KEY`,
    },
  },
  ...BRIM_SYNC_CREDENTIALS,
  WOODPECKER_TOKEN: {
    description: "Woodpecker CI API token",
    source: {
      kind: "op",
      ref: `${HOMELAB_VAULT_REF}/${WOODPECKER_ITEM}/WOODPECKER_API_TOKEN`,
    },
  },
  TEMPORAL_API_KEY: {
    description: "Temporal external API key",
    source: {
      kind: "op",
      ref: "op://v64ocnykdqju4ui6j6pua56xw4/2x4fpii5zq4jbw3l2p2qkvjtiy/api-token",
    },
  },
};
