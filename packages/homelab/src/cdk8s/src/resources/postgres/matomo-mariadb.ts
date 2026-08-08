import { Construct } from "constructs";
import { Application } from "@shepherdjerred/homelab/cdk8s/generated/imports/argoproj.io.ts";
import { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { vaultItemPath } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

export type MatomoMariaDBProps = {
  namespace: string;
  storageClass?: string;
  storageSize?: string;
};

function imageDigest(image: string): string {
  const digest = image.split("@")[1];
  if (digest === undefined) {
    throw new Error(`Expected an immutable image reference, got ${image}`);
  }
  return digest;
}

export class MatomoMariaDB extends Construct {
  public readonly serviceName: string;
  public readonly application: Application;
  public readonly secretItem: OnePasswordItem;
  public readonly databaseName = "matomo";
  public readonly username = "matomo";

  constructor(scope: Construct, id: string, props: MatomoMariaDBProps) {
    super(scope, id);

    const releaseName = id;
    this.serviceName = releaseName;

    // The item contains mariadb-root-password, mariadb-password, and
    // mariadb-metrics-password fields. It is deliberately separate from the
    // Postal database credentials so the analytics service can be removed or
    // rotated independently.
    this.secretItem = new OnePasswordItem(scope, `${id}-credentials`, {
      metadata: {
        name: `${id}-credentials`,
        namespace: props.namespace,
      },
      spec: {
        itemPath: vaultItemPath("5lstnmhcewdtrrs7dtutqhq2xu"),
      },
    });

    const mariadbValues: Record<string, unknown> = {
      image: {
        registry: "registry-1.docker.io",
        repository: "bitnami/mariadb",
        tag: "latest",
        digest: imageDigest(versions["bitnami/mariadb"]),
      },
      auth: {
        existingSecret: this.secretItem.name,
        database: this.databaseName,
        username: this.username,
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
        extraConfiguration: `
max_connections = 200
innodb_buffer_pool_size = 1G
innodb_flush_log_at_trx_commit = 2
max_allowed_packet = 64M
character-set-server = utf8mb4
collation-server = utf8mb4_unicode_ci
`,
      },
      metrics: {
        enabled: true,
        image: {
          registry: "registry-1.docker.io",
          repository: "bitnami/mysqld-exporter",
          tag: "latest",
          digest: imageDigest(versions["bitnami/mysqld-exporter"]),
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
          additionalLabels: {
            release: "prometheus",
          },
        },
      },
      networkPolicy: {
        enabled: false,
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
            releaseName,
            valuesObject: mariadbValues,
          },
        },
        destination: {
          server: "https://kubernetes.default.svc",
          namespace: props.namespace,
        },
        syncPolicy: {
          automated: {},
          syncOptions: ["CreateNamespace=true"],
        },
      },
    });
  }
}
