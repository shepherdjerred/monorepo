import { Chart } from "cdk8s";
import {
  KubeJob,
  KubeServiceAccount,
  KubeClusterRole,
  KubeClusterRoleBinding,
  Quantity,
} from "../../generated/imports/k8s.ts";
import versions from "../versions.ts";

/**
 * Creates a Job that syncs Tailscale ingresses to golink.
 *
 * This job:
 * 1. Lists all ingresses with ingressClassName: tailscale
 * 2. Extracts their hostnames from the status.loadBalancer.ingress[0].hostname
 * 3. Creates golink aliases for each (short name -> https://hostname/)
 * 4. Deletes stale golinks that point to *.tailnet-1a49.ts.net but no longer have an ingress
 *
 * The job runs as an ArgoCD PostSync hook, so it executes after each successful sync.
 *
 * A Tailscale sidecar provides network access to the tailnet, allowing the job
 * to reach golink at go.tailnet-xxx.ts.net via an HTTP proxy.
 */
export function createGolinkSyncJob(chart: Chart) {
  const namespace = chart.namespace ?? "golink";
  const name = "golink-sync";
  const tailnetDomain = "tailnet-1a49.ts.net";
  const golinkUrl = `https://go.${tailnetDomain}`;
  const tailscaleImage = `tailscale/tailscale:v${versions["tailscale-operator"]}`;

  // ServiceAccount for the sync job
  const serviceAccount = new KubeServiceAccount(chart, "golink-sync-sa", {
    metadata: {
      name: `${name}-sa`,
      namespace,
    },
  });

  // ClusterRole to list ingresses across all namespaces
  const clusterRole = new KubeClusterRole(chart, "golink-sync-role", {
    metadata: {
      name: `${name}-role`,
    },
    rules: [
      {
        apiGroups: ["networking.k8s.io"],
        resources: ["ingresses"],
        verbs: ["list"],
      },
    ],
  });

  // Bind the ClusterRole to the ServiceAccount
  new KubeClusterRoleBinding(chart, "golink-sync-binding", {
    metadata: {
      name: `${name}-binding`,
    },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "ClusterRole",
      name: clusterRole.name,
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: serviceAccount.name,
        namespace,
      },
    ],
  });

  // The sync script - uses Tailscale HTTP proxy on localhost:1055
  const syncScript = `
set -e

# Signal completion to sidecar on exit
cleanup() {
  echo "Signaling completion to sidecar..."
  touch /shared/done
}
trap cleanup EXIT

# Install kubectl and dependencies
echo "Installing dependencies..."
apt-get update -qq && apt-get install -y -qq curl jq > /dev/null
curl -sLO "https://dl.k8s.io/release/v1.33.0/bin/linux/amd64/kubectl"
chmod +x kubectl && mv kubectl /usr/local/bin/
echo "kubectl installed: $(kubectl version --client --short 2>/dev/null || kubectl version --client)"

# Wait for Tailscale proxy to be ready
echo "Waiting for Tailscale proxy..."
for i in $(seq 1 30); do
  if curl -s --max-time 2 --proxy http://localhost:1055 https://go.${tailnetDomain}/ > /dev/null 2>&1; then
    echo "Tailscale proxy is ready"
    break
  fi
  if [ $i -eq 30 ]; then
    echo "ERROR: Tailscale proxy not ready after 30 seconds"
    exit 1
  fi
  sleep 1
done

# Use Tailscale HTTP proxy for all curl commands to tailnet
export https_proxy=http://localhost:1055
export HTTPS_PROXY=http://localhost:1055

GOLINK_URL="${golinkUrl}"
TAILNET_DOMAIN="${tailnetDomain}"

echo "=== Golink Sync Job ==="
echo "Golink URL: $GOLINK_URL"
echo ""

# Get all tailscale ingresses and extract their hostnames
echo "Fetching Tailscale ingresses..."
INGRESSES=$(kubectl get ingress --all-namespaces -o json | jq -r '
  .items[]
  | select(.spec.ingressClassName == "tailscale")
  | .status.loadBalancer.ingress[0].hostname // empty
' | sort -u | grep -v '^$' || true)

if [ -z "$INGRESSES" ]; then
  echo "No Tailscale ingresses found"
  exit 0
fi

echo "Found ingresses:"
echo "$INGRESSES" | while read hostname; do
  echo "  - $hostname"
done
echo ""

# Build a list of expected golinks (short -> long URL)
declare -A EXPECTED_LINKS
while read hostname; do
  if [ -n "$hostname" ]; then
    # Extract short name: "plex.tailnet-1a49.ts.net" -> "plex"
    short=$(echo "$hostname" | sed "s/\\.$TAILNET_DOMAIN$//")
    long="https://$hostname/"
    EXPECTED_LINKS["$short"]="$long"
  fi
done <<< "$INGRESSES"

# Get existing golinks
echo "Fetching existing golinks..."
EXISTING=$(curl -sL -H "Sec-Golink: 1" "$GOLINK_URL/.export" 2>/dev/null || echo "")

if [ -z "$EXISTING" ]; then
  echo "Warning: Could not fetch existing golinks or none exist"
  EXISTING=""
fi

# Parse existing golinks into associative array
declare -A EXISTING_LINKS
while IFS= read -r line; do
  if [ -n "$line" ]; then
    short=$(echo "$line" | jq -r '.Short')
    long=$(echo "$line" | jq -r '.Long')
    EXISTING_LINKS["$short"]="$long"
  fi
done <<< "$EXISTING"

echo "Existing golinks: \${#EXISTING_LINKS[@]}"
echo ""

# Create missing golinks
echo "=== Creating missing golinks ==="
created=0
for short in "\${!EXPECTED_LINKS[@]}"; do
  long="\${EXPECTED_LINKS[$short]}"
  existing="\${EXISTING_LINKS[$short]:-}"

  if [ -z "$existing" ]; then
    echo "Creating: go/$short -> $long"
    response=$(curl -sL -X POST "$GOLINK_URL/" \\
      -H "Sec-Golink: 1" \\
      -H "Content-Type: application/x-www-form-urlencoded" \\
      -d "short=$short&long=$long" 2>/dev/null || echo "FAILED")

    if echo "$response" | grep -q "FAILED"; then
      echo "  Failed to create go/$short"
    else
      created=$((created + 1))
    fi
  elif [ "$existing" != "$long" ]; then
    echo "Updating: go/$short -> $long (was: $existing)"
    curl -sL -X POST "$GOLINK_URL/" \\
      -H "Sec-Golink: 1" \\
      -H "Content-Type: application/x-www-form-urlencoded" \\
      -d "short=$short&long=$long" 2>/dev/null || echo "  Failed to update"
    created=$((created + 1))
  fi
done
echo "Created/updated: $created"
echo ""

# Delete stale golinks (ones pointing to tailnet that no longer have an ingress)
echo "=== Cleaning up stale golinks ==="
deleted=0
while IFS= read -r line; do
  if [ -n "$line" ]; then
    short=$(echo "$line" | jq -r '.Short')
    long=$(echo "$line" | jq -r '.Long')

    # Only consider links pointing to our tailnet
    if echo "$long" | grep -q "$TAILNET_DOMAIN"; then
      expected="\${EXPECTED_LINKS[$short]:-}"

      if [ -z "$expected" ]; then
        echo "Deleting stale: go/$short -> $long"
        # Fetch the detail page to get the XSRF token (required for deletion)
        detail_page=$(curl -sL "$GOLINK_URL/.detail/$short" -H "Sec-Golink: 1" 2>/dev/null)
        # Use sed instead of grep -P (Perl regex not available in base debian)
        xsrf_token=$(echo "$detail_page" | sed -n 's/.*name="xsrf" value="\\([^"]*\\)".*/\\1/p' | head -1)

        if [ -n "$xsrf_token" ]; then
          curl -sL -X POST "$GOLINK_URL/.delete/$short" \\
            -H "Sec-Golink: 1" \\
            -H "Content-Type: application/x-www-form-urlencoded" \\
            -d "xsrf=$xsrf_token" 2>/dev/null || echo "  Failed to delete"
          deleted=$((deleted + 1))
        else
          echo "  Could not get XSRF token for $short"
        fi
      fi
    fi
  fi
done <<< "$EXISTING"
echo "Deleted: $deleted"
echo ""

echo "=== Sync complete ==="
`;

  // Tailscale sidecar script - provides HTTP proxy and exits when main container signals done
  const tailscaleSidecarScript = `
#!/bin/sh
set -e

echo "Starting Tailscale sidecar..."

# Start containerboot in background
/usr/local/bin/containerboot &
CONTAINERBOOT_PID=$!

# Wait for done signal from main container
echo "Waiting for main container to complete..."
while [ ! -f /shared/done ]; do
  # Check if containerboot is still running
  if ! kill -0 $CONTAINERBOOT_PID 2>/dev/null; then
    echo "ERROR: containerboot exited unexpectedly"
    exit 1
  fi
  sleep 1
done

echo "Main container completed, shutting down Tailscale..."
kill $CONTAINERBOOT_PID 2>/dev/null || true
exit 0
`;

  // Create the Job with ArgoCD PostSync hook annotation
  new KubeJob(chart, "golink-sync-job", {
    metadata: {
      name,
      namespace,
      annotations: {
        // ArgoCD hook: run after successful sync
        "argocd.argoproj.io/hook": "PostSync",
        // Delete the job after it completes (success or failure)
        "argocd.argoproj.io/hook-delete-policy": "BeforeHookCreation",
        // kube-linter exclusions
        "ignore-check.kube-linter.io/run-as-non-root": "Containers run as default users for package installation",
        "ignore-check.kube-linter.io/no-read-only-root-fs":
          "Containers require writable filesystem for package installation",
      },
    },
    spec: {
      // Don't retry on failure
      backoffLimit: 1,
      // Clean up after 1 minute
      ttlSecondsAfterFinished: 60,
      template: {
        spec: {
          serviceAccountName: serviceAccount.name,
          restartPolicy: "Never",
          // Shared volume for signaling between containers
          volumes: [
            {
              name: "shared",
              emptyDir: {},
            },
            {
              name: "tailscale-state",
              emptyDir: {},
            },
          ],
          containers: [
            // Main sync container
            {
              name: "golink-sync",
              image: `docker.io/library/debian:${versions["library/debian"]}`,
              command: ["/bin/bash", "-c", syncScript],
              volumeMounts: [
                {
                  name: "shared",
                  mountPath: "/shared",
                },
              ],
              resources: {
                requests: {
                  cpu: Quantity.fromString("50m"),
                  memory: Quantity.fromString("64Mi"),
                },
                limits: {
                  cpu: Quantity.fromString("200m"),
                  memory: Quantity.fromString("128Mi"),
                },
              },
            },
            // Tailscale sidecar - provides HTTP proxy to tailnet
            {
              name: "tailscale",
              image: tailscaleImage,
              command: ["/bin/sh", "-c", tailscaleSidecarScript],
              env: [
                {
                  name: "TS_AUTHKEY",
                  valueFrom: {
                    secretKeyRef: {
                      name: "tailscale-auth-key",
                      key: "credential",
                    },
                  },
                },
                // Run in userspace mode (no kernel networking needed)
                { name: "TS_USERSPACE", value: "true" },
                // Accept Tailscale DNS for resolving go.tailnet-xxx.ts.net
                { name: "TS_ACCEPT_DNS", value: "true" },
                // Provide HTTP proxy on port 1055 for main container
                { name: "TS_OUTBOUND_HTTP_PROXY_LISTEN", value: ":1055" },
                // Only authenticate once
                { name: "TS_AUTH_ONCE", value: "true" },
                // Disable Kubernetes secret storage mode
                { name: "TS_KUBE_SECRET", value: "" },
                // Use ephemeral state (no persistence needed for short-lived job)
                { name: "TS_STATE_DIR", value: "/tmp/tailscale" },
                // Unique hostname for this job instance
                { name: "TS_HOSTNAME", value: "golink-sync-job" },
              ],
              volumeMounts: [
                {
                  name: "shared",
                  mountPath: "/shared",
                },
                {
                  name: "tailscale-state",
                  mountPath: "/tmp/tailscale",
                },
              ],
              resources: {
                requests: {
                  cpu: Quantity.fromString("10m"),
                  memory: Quantity.fromString("32Mi"),
                },
                limits: {
                  cpu: Quantity.fromString("100m"),
                  memory: Quantity.fromString("128Mi"),
                },
              },
              // Run as root for state directory permissions (short-lived ephemeral job)
            },
          ],
        },
      },
    },
  });

  return { serviceAccount, clusterRole };
}
