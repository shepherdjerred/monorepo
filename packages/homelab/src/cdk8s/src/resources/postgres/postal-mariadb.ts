import { Construct } from "constructs";
import { Application } from "../../../generated/imports/argoproj.io.ts";
import { OnePasswordItem } from "../../../generated/imports/onepassword.com.ts";
import versions from "../../versions.ts";

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
   * Expected fields: mariadb-root-password, mariadb-password
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
    // Expected fields: mariadb-root-password, mariadb-password
    this.secretItem = new OnePasswordItem(scope, `${id}-credentials`, {
      metadata: {
        name: `${id}-credentials`,
        namespace: props.namespace,
      },
      spec: {
        itemPath: "vaults/v64ocnykdqju4ui6j6pua56xw4/items/zlz4hlpcgk74nhqysgrre5wv4i",
      },
    });

    const mariadbValues: Record<string, unknown> = {
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
          },
        },
        resources: {
          requests: {
            cpu: "250m",
            memory: "512Mi",
          },
          limits: {
            cpu: "2000m",
            memory: "4Gi",
          },
        },
        // Extra MariaDB configuration for mail server
        // Note: Using extraConfiguration to append to defaults (keeps bind-address=0.0.0.0)
        extraConfiguration: `
max_connections = 200
innodb_buffer_pool_size = 1G
innodb_flush_log_at_trx_commit = 2
max_allowed_packet = 64M
character-set-server = utf8mb4
collation-server = utf8mb4_unicode_ci
`,
      },
      // Enable metrics for monitoring
      metrics: {
        enabled: true,
        serviceMonitor: {
          enabled: true,
          additionalLabels: {
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
          automated: {},
          syncOptions: ["CreateNamespace=true"],
        },
      },
    });
  }
}
