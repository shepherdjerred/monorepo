import { Construct } from "constructs";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";
import type { HelmValuesForChart } from "@shepherdjerred/homelab/cdk8s/src/misc/typed-helm-parameters.ts";

/** `tag@sha256:<64 hex>` — the only shape that pins an image immutably. */
const PINNED_IMAGE_PATTERN = /^(?<tag>[^@\s]+)@(?<digest>sha256:[\da-f]{64})$/;

/**
 * Split a `tag@sha256:…` catalog value into the chart's `tag`/`digest` pair.
 *
 * The Bitnami charts publish only mutable `:latest` image tags (versioned tags
 * moved behind Bitnami Secure Images), so the tag alone pins nothing — a pod
 * reschedule can land on a different server build. `image.digest` overrides the
 * tag in these charts, which is what actually makes the reference immutable.
 *
 * The digest is therefore REQUIRED, not optional. A catalog entry that loses
 * its `@sha256:` suffix must fail the synth loudly: returning a bare tag would
 * silently put the live Postal database back on mutable `:latest` while this
 * file still claims to pin it. `VersionCatalogEntrySchema` accepts a digestless
 * value, so this is the boundary that has to reject it.
 */
function imageRef(value: string): { tag: string; digest: string } {
  const groups = PINNED_IMAGE_PATTERN.exec(value)?.groups;
  const tag = groups?.["tag"];
  const digest = groups?.["digest"];
  if (tag === undefined || digest === undefined) {
    throw new Error(
      `catalog image value must be "tag@sha256:<64 hex>" so the reference is immutable, got: ${value}`,
    );
  }
  return { tag, digest };
}

export type PostalMariaDBProps = {
  /**
   * The namespace to deploy MariaDB into.
   */
  namespace: string;
  /**
   * Storage class for persistence. Defaults to "zfs-ssd".
   */
  storageClass?: string;
  /**
   * Storage size for MariaDB data. Defaults to "32Gi".
   */
  storageSize?: string;
};

export class PostalMariaDB extends Construct {
  /**
   * The service name to connect to MariaDB (e.g., for use in DB_HOST env vars).
   */
  public readonly serviceName: string;

  /**
   * The ArgoCD Application resource.
   */
  public readonly application: Application;

  /**
   * The 1Password item containing MariaDB credentials.
   * Expected fields: mariadb-root-password, mariadb-password, mariadb-metrics-password
   */
  public readonly secretItem: OnePasswordItem;

  /**
   * Database name for Postal.
   */
  public readonly databaseName = "postal";

  /**
   * Username for Postal database access.
   */
  public readonly username = "postal";

  constructor(scope: Construct, id: string, props: PostalMariaDBProps) {
    super(scope, id);

    const releaseName = id;

    // Bitnami MariaDB service name is just the release name
    this.serviceName = releaseName;

    // 1Password item for MariaDB credentials
    // Expected fields: mariadb-root-password, mariadb-password, mariadb-metrics-password
    // (chart v26+ requires mariadb-metrics-password in auth.existingSecret when metrics are enabled)
    this.secretItem = new OnePasswordItem(scope, `${id}-credentials`, {
      metadata: {
        name: `${id}-credentials`,
        namespace: props.namespace,
      },
      spec: {
        itemPath: vaultItemPath("zlz4hlpcgk74nhqysgrre5wv4i"),
      },
    });

    const mariadbValues: HelmValuesForChart<"mariadb"> = {
      // Pin the server image by digest. The chart defaults to
      // `bitnami/mariadb:latest`, so without this the live Postal database
      // follows whatever `latest` resolves to at pull time.
      image: {
        repository: "bitnami/mariadb",
        ...imageRef(versions["bitnami/mariadb"]),
      },
      auth: {
        existingSecret: this.secretItem.name,
        database: this.databaseName,
        username: this.username,
      },
      // Grant postal user ability to create/manage message databases (postal-server-*)
      initdbScripts: {
        "grant-privileges.sql": `
          GRANT ALL PRIVILEGES ON \`postal-%\`.* TO '${this.username}'@'%';
          FLUSH PRIVILEGES;
        `,
      },
      primary: {
        persistence: {
          enabled: true,
          storageClass: props.storageClass ?? "zfs-ssd",
          size: props.storageSize ?? "32Gi",
          labels: {
            "velero.io/backup": "enabled",
            "velero.io/exclude-from-backup": "false",
          },
        },
        resources: {
          requests: {
            cpu: "100m",
            memory: "256Mi",
          },
          limits: {
            cpu: "2000m",
            memory: "4Gi",
          },
        },
        // NOTE: a `primary.extraConfiguration` block used to sit here carrying
        // mail-server tuning (max_connections=200, innodb_buffer_pool_size=1G,
        // innodb_flush_log_at_trx_commit=2, max_allowed_packet=64M, utf8mb4).
        // The Bitnami chart has no such value — not in 26.2.0 and not in 27.x —
        // so Helm silently discarded it and the tuning was never applied. It was
        // removed rather than "fixed" because the chart's only knob is
        // `primary.configuration`, which REPLACES the whole my.cnf (including
        // bind-address=0.0.0.0) instead of appending. Applying this tuning for
        // real means copying the chart default and editing it, which is a live
        // database config change and belongs in its own reviewed PR.
      },
      // Enable metrics for monitoring. Chart v26+ runs the exporter as a dedicated
      // low-privilege `exporter` user authenticated via the mariadb-metrics-password
      // key of auth.existingSecret (no root-password env override needed).
      metrics: {
        enabled: true,
        // Same `:latest` problem as the server image above.
        image: {
          repository: "bitnami/mysqld-exporter",
          ...imageRef(versions["bitnami/mysqld-exporter"]),
        },
        resources: {
          requests: {
            cpu: "50m",
            memory: "64Mi",
          },
          limits: {
            cpu: "500m",
            memory: "128Mi",
          },
        },
        serviceMonitor: {
          enabled: true,
          // `labels`, not `additionalLabels` — that is the sibling charts'
          // (velero/argocd/seaweedfs) spelling and it was copied here by
          // mistake, so this ServiceMonitor never carried `release: prometheus`
          // and kube-prometheus-stack never selected it
          // (serviceMonitorSelectorNilUsesHelmValues defaults to true).
          labels: {
            release: "prometheus",
          },
        },
      },
    };

    this.application = new Application(scope, `${id}-app`, {
      metadata: {
        name: id,
        namespace: "argocd",
      },
      spec: {
        project: "default",
        source: {
          repoUrl: "https://charts.bitnami.com/bitnami",
          targetRevision: versions.mariadb,
          chart: "mariadb",
          helm: {
            releaseName: releaseName,
            valuesObject: mariadbValues,
          },
        },
        destination: {
          server: "https://kubernetes.default.svc",
          namespace: props.namespace,
        },
        syncPolicy: {
          automated: { enabled: true },
          syncOptions: ["CreateNamespace=true"],
        },
      },
    });
  }
}
