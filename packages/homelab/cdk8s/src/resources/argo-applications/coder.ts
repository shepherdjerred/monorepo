import { Chart } from "cdk8s";
import { Application } from "../../../generated/imports/argoproj.io.ts";
import { Namespace } from "cdk8s-plus-31";
import { PodMonitor } from "../../../generated/imports/monitoring.coreos.com.ts";
import { OnePasswordItem } from "../../../generated/imports/onepassword.com.ts";
import { KubeClusterRole, KubeClusterRoleBinding } from "../../../generated/imports/k8s.ts";
import versions from "../../versions.ts";
import { createIngress } from "../../misc/tailscale.ts";
import { createCloudflareTunnelBinding } from "../../misc/cloudflare-tunnel.ts";
import { createCoderPostgreSQLDatabase } from "../postgres/coder-db.ts";
import type { HelmValuesForChart } from "../../misc/typed-helm-parameters.ts";

export function createCoderApp(chart: Chart) {
  // Create namespace with privileged pod security for rootless DinD workspaces
  new Namespace(chart, "coder-namespace", {
    metadata: {
      name: "coder",
      labels: {
        "pod-security.kubernetes.io/enforce": "privileged",
        "pod-security.kubernetes.io/audit": "privileged",
        "pod-security.kubernetes.io/warn": "privileged",
      },
    },
  });

  // Create PostgreSQL database for Coder
  createCoderPostgreSQLDatabase(chart);

  // Create Tailscale ingress for Coder
  createIngress(chart, "coder-ingress", "coder", "coder", 80, ["coder"], true);

  createCloudflareTunnelBinding(chart, "coder-cf-tunnel", {
    serviceName: "coder",
    subdomain: "coder",
    namespace: "coder",
  });

  // Create 1Password item for GitHub OAuth credentials
  // Create an item in 1Password vault "Kubernetes" with:
  // - Field name "client-id": Your GitHub OAuth App Client ID
  // - Field name "client-secret": Your GitHub OAuth App Client Secret
  // To create a GitHub OAuth App:
  // 1. Go to https://github.com/settings/developers
  // 2. Click "New OAuth App"
  // 3. Homepage URL: https://coder.tailnet-1a49.ts.net
  // 4. Authorization callback URL: https://coder.tailnet-1a49.ts.net/external-auth/primary-github/callback
  const githubOAuthSecret = new OnePasswordItem(chart, "coder-github-oauth", {
    metadata: {
      name: "coder-github-oauth",
      namespace: "coder",
    },
    spec: {
      itemPath: "vaults/v64ocnykdqju4ui6j6pua56xw4/items/op63camrorymbnz734lx3pw5pe",
    },
  });
  // Create ClusterRole for CRD read permissions
  // CRDs are cluster-scoped resources, so they require ClusterRole (not Role)
  // Required for workspace Terraform to validate OnePasswordItem CRD
  new KubeClusterRole(chart, "coder-crd-reader", {
    metadata: {
      name: "coder-crd-reader",
    },
    rules: [
      {
        apiGroups: ["apiextensions.k8s.io"],
        resources: ["customresourcedefinitions"],
        verbs: ["get", "list"],
      },
    ],
  });

  // Bind the ClusterRole to the Coder service account
  new KubeClusterRoleBinding(chart, "coder-crd-reader-binding", {
    metadata: {
      name: "coder-crd-reader-binding",
    },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "ClusterRole",
      name: "coder-crd-reader",
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: "coder",
        namespace: "coder",
      },
    ],
  });

  const coderValues: HelmValuesForChart<"coder"> = {
    coder: {
      // Grant the Coder service account permission to manage OnePasswordItems
      // These are namespace-scoped resources, so namespace-scoped Role is sufficient
      serviceAccount: {
        extraRules: [
          {
            apiGroups: ["onepassword.com"],
            resources: ["onepassworditems"],
            verbs: ["create", "get", "list", "delete", "patch", "update"],
          },
        ],
      },
      // Init container to build the PostgreSQL connection URL from postgres-operator secret
      initContainers: [
        {
          name: "build-db-url",
          image: `docker.io/busybox:${versions["library/busybox"]}`,
          command: ["/bin/sh", "-c"],
          args: [
            `
            USER=$(cat /pg-secret/username)
            PASS=$(cat /pg-secret/password)
            DB=$(cat /pg-secret/dbname)
            echo "postgres://$USER:$PASS@coder-postgresql:5432/$DB?sslmode=disable" > /db-url/url
            echo "Database URL built successfully"
            `,
          ],
          volumeMounts: [
            {
              name: "pg-secret",
              mountPath: "/pg-secret",
              readOnly: true,
            },
            {
              name: "db-url",
              mountPath: "/db-url",
            },
          ],
        },
      ],
      // Mount the postgres-operator secret and shared volume for the URL
      volumes: [
        {
          name: "pg-secret",
          secret: {
            secretName: "coder.coder-postgresql.credentials.postgresql.acid.zalan.do",
          },
        },
        {
          name: "db-url",
          emptyDir: {},
        },
      ],
      // Additional volume mounts for main container to read the built URL
      volumeMounts: [
        {
          name: "db-url",
          mountPath: "/db-url",
          readOnly: true,
        },
      ],
      // Override the command to read DB URL from file before starting Coder
      command: ["/bin/sh", "-c"],
      commandArgs: ["export CODER_PG_CONNECTION_URL=$(cat /db-url/url) && exec /opt/coder server"],
      env: [
        {
          name: "CODER_ACCESS_URL",
          value: "https://coder.tailnet-1a49.ts.net",
        },
        // Enable GitHub OAuth with allow signups
        {
          name: "CODER_OAUTH2_GITHUB_ALLOW_SIGNUPS",
          value: "false",
        },
        {
          name: "CODER_OAUTH2_GITHUB_ALLOW_EVERYONE",
          value: "false",
        },
        {
          name: "CODER_PROMETHEUS_ENABLE",
          value: "true",
        },
        // GitHub External Auth for Git authentication in workspaces
        // This enables users to authenticate with GitHub to clone private repos
        {
          name: "CODER_EXTERNAL_AUTH_0_ID",
          value: "primary-github",
        },
        {
          name: "CODER_EXTERNAL_AUTH_0_TYPE",
          value: "github",
        },
        {
          name: "CODER_EXTERNAL_AUTH_0_CLIENT_ID",
          valueFrom: {
            secretKeyRef: {
              name: githubOAuthSecret.name,
              key: "client-id",
            },
          },
        },
        {
          name: "CODER_EXTERNAL_AUTH_0_CLIENT_SECRET",
          valueFrom: {
            secretKeyRef: {
              name: githubOAuthSecret.name,
              key: "client-secret",
            },
          },
        },
        {
          name: "CODER_EXTERNAL_AUTH_0_DISPLAY_NAME",
          value: "GitHub",
        },
        {
          name: "CODER_EXTERNAL_AUTH_0_DISPLAY_ICON",
          value: "https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png",
        },
      ],
      service: {
        type: "ClusterIP",
        sessionAffinity: "ClientIP",
      },
      resources: {
        requests: {
          cpu: "250m",
          memory: "512Mi",
        },
        limits: {
          cpu: "1000m",
          memory: "2Gi",
        },
      },
    },
  };

  // Create PodMonitor for Prometheus to scrape Coder metrics directly from pods
  new PodMonitor(chart, "coder-pod-monitor", {
    metadata: {
      name: "coder-pod-monitor",
      namespace: "coder",
      labels: {
        release: "prometheus", // This label is required for the Prometheus operator to discover it
      },
    },
    spec: {
      podMetricsEndpoints: [
        {
          port: "prometheus-http", // Port name from the pod container
          interval: "10s",
          scrapeTimeout: "10s",
        },
      ],
      namespaceSelector: {
        matchNames: ["coder"],
      },
      selector: {
        matchLabels: {
          "app.kubernetes.io/name": "coder",
        },
      },
    },
  });

  return new Application(chart, "coder-app", {
    metadata: {
      name: "coder",
    },
    spec: {
      revisionHistoryLimit: 5,
      project: "default",
      source: {
        repoUrl: "https://helm.coder.com/v2",
        chart: "coder",
        targetRevision: versions.coder,
        helm: {
          valuesObject: coderValues,
        },
      },
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: "coder",
      },
      syncPolicy: {
        automated: {},
        syncOptions: ["CreateNamespace=true"],
      },
    },
  });
}
