import type { Chart } from "cdk8s";
import {
  KubeJob,
  KubeServiceAccount,
  KubeRole,
  KubeRoleBinding,
  Quantity,
} from "@shepherdjerred/homelab/cdk8s/generated/imports/k8s.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

const NAMESPACE = "windmill";
const PG_SECRET_NAME =
  "windmill.windmill-postgresql.credentials.postgresql.acid.zalan.do";
const DB_URL_SECRET_NAME = "windmill-db-url";

/**
 * Creates a Job that reads the postgres-operator auto-generated credentials
 * and creates a K8s Secret containing the full DATABASE_URL for Windmill.
 *
 * This eliminates the need to manually copy the password to 1Password.
 * The Job runs as an ArgoCD PostSync hook after the Postgresql CRD is applied.
 */
export function createWindmillDbUrlJob(chart: Chart) {
  const sa = new KubeServiceAccount(chart, "windmill-db-url-sa", {
    metadata: {
      name: "windmill-db-url-job",
      namespace: NAMESPACE,
    },
  });

  const role = new KubeRole(chart, "windmill-db-url-role", {
    metadata: {
      name: "windmill-db-url-job",
      namespace: NAMESPACE,
    },
    rules: [
      {
        apiGroups: [""],
        resources: ["secrets"],
        resourceNames: [
          PG_SECRET_NAME,
          "postgres.windmill-postgresql.credentials.postgresql.acid.zalan.do",
        ],
        verbs: ["get"],
      },
      {
        apiGroups: [""],
        resources: ["secrets"],
        verbs: ["create", "update", "patch", "get"],
      },
    ],
  });

  new KubeRoleBinding(chart, "windmill-db-url-binding", {
    metadata: {
      name: "windmill-db-url-job",
      namespace: NAMESPACE,
    },
    roleRef: {
      apiGroup: "rbac.authorization.k8s.io",
      kind: "Role",
      name: role.name,
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: sa.name,
        namespace: NAMESPACE,
      },
    ],
  });

  // Shell script that waits for the postgres-operator secret, reads credentials,
  // and creates the windmill-db-url secret with the full DATABASE_URL.
  // Uses the K8s API directly via curl + service account token.
  // Alpine is used instead of busybox because busybox wget lacks --ca-certificate.
  // K8s secret name for the postgres superuser credentials (not a secret itself)
  const pgAdminSecretName =
    "postgres.windmill-postgresql.credentials.postgresql.acid.zalan.do";
  // Template for the DATABASE_URL — uses shell variables, not actual credentials
  const dbUrlTemplate = `postgres://\\\${USER}:\\\${PASS}@windmill-postgresql.${NAMESPACE}:5432/windmill_db?sslmode=disable`;

  const script = String.raw`
set -e

apk add --no-cache curl postgresql-client > /dev/null 2>&1

API="https://kubernetes.default.svc"
TOKEN=$(cat /var/run/secrets/kubernetes.io/serviceaccount/token)
CA=/var/run/secrets/kubernetes.io/serviceaccount/ca.crt
NS="${NAMESPACE}"
PG_SECRET="${PG_SECRET_NAME}"
URL_SECRET="${DB_URL_SECRET_NAME}"

auth() {
  curl -sf --cacert "$CA" -H "Authorization: Bearer $TOKEN" "$@"
}

echo "Waiting for postgres-operator secret..."
for i in $(seq 1 60); do
  if auth "$API/api/v1/namespaces/$NS/secrets/$PG_SECRET" -o /dev/null; then
    echo "Secret found."
    break
  fi
  if [ "$i" = "60" ]; then
    echo "ERROR: Secret not found after 10 minutes"
    exit 1
  fi
  echo "Attempt $i/60: waiting 10s..."
  sleep 10
done

# Read credentials (base64-encoded in the secret)
SECRET_JSON=$(auth "$API/api/v1/namespaces/$NS/secrets/$PG_SECRET")
B64_USER=$(echo "$SECRET_JSON" | sed -n 's/.*"username" *: *"\([^"]*\)".*/\1/p')
B64_PASS=$(echo "$SECRET_JSON" | sed -n 's/.*"password" *: *"\([^"]*\)".*/\1/p')
USER=$(echo "$B64_USER" | base64 -d)
PASS=$(echo "$B64_PASS" | base64 -d)

echo "Credentials read: user=$USER"

# Also read the postgres superuser credentials to create required roles
PG_ADMIN_SECRET="${pgAdminSecretName}"
ADMIN_JSON=$(auth "$API/api/v1/namespaces/$NS/secrets/$PG_ADMIN_SECRET")
ADMIN_B64_PASS=$(echo "$ADMIN_JSON" | sed -n 's/.*"password" *: *"\([^"]*\)".*/\1/p')
ADMIN_PASS=$(echo "$ADMIN_B64_PASS" | base64 -d)

# Run Windmill's init-db-as-superuser.sql equivalent.
# Creates roles with proper permissions for Row Level Security.
# Idempotent: uses IF NOT EXISTS and re-applies grants.
echo "Running Windmill DB init (roles + grants)..."
PGPASSWORD="$ADMIN_PASS" psql -h "windmill-postgresql.${NAMESPACE}" -U postgres -d windmill_db -c "
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'windmill_user') THEN
    CREATE ROLE windmill_user;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'windmill_admin') THEN
    CREATE ROLE windmill_admin;
  END IF;
END
\$\$;

GRANT ALL ON ALL TABLES IN SCHEMA public TO windmill_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO windmill_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO windmill_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO windmill_user;
ALTER ROLE windmill_admin WITH BYPASSRLS;
GRANT windmill_user TO windmill_admin;
GRANT windmill_admin, windmill_user TO $USER;
" 2>&1
echo "PG roles and grants ready."

# Build DATABASE_URL
DB_URL="${dbUrlTemplate}"
B64_URL=$(echo -n "$DB_URL" | base64 | tr -d '\n')

# Create or update the windmill-db-url secret
SECRET_BODY="{\"apiVersion\":\"v1\",\"kind\":\"Secret\",\"metadata\":{\"name\":\"$URL_SECRET\",\"namespace\":\"$NS\"},\"data\":{\"url\":\"$B64_URL\"}}"

STATUS=$(auth "$API/api/v1/namespaces/$NS/secrets/$URL_SECRET" -o /dev/null -w "%{http_code}" || echo "404")
if [ "$STATUS" = "200" ]; then
  echo "Updating existing $URL_SECRET secret..."
  auth "$API/api/v1/namespaces/$NS/secrets/$URL_SECRET" -X PUT -H "Content-Type: application/json" -d "$SECRET_BODY" > /dev/null
else
  echo "Creating $URL_SECRET secret..."
  auth "$API/api/v1/namespaces/$NS/secrets" -X POST -H "Content-Type: application/json" -d "$SECRET_BODY" > /dev/null
fi

echo "Done: $URL_SECRET secret ready."
`;

  new KubeJob(chart, "windmill-db-url-job", {
    metadata: {
      name: "windmill-db-url-job",
      namespace: NAMESPACE,
      annotations: {
        "argocd.argoproj.io/hook": "PostSync",
        "argocd.argoproj.io/hook-delete-policy": "BeforeHookCreation",
      },
    },
    spec: {
      backoffLimit: 3,
      ttlSecondsAfterFinished: 300,
      template: {
        spec: {
          serviceAccountName: sa.name,
          restartPolicy: "OnFailure",
          containers: [
            {
              name: "build-db-url",
              image: `docker.io/library/alpine:${versions["library/alpine"]}`,
              command: ["/bin/sh", "-c", script],
              resources: {
                requests: {
                  cpu: Quantity.fromString("10m"),
                  memory: Quantity.fromString("16Mi"),
                },
                limits: {
                  cpu: Quantity.fromString("100m"),
                  memory: Quantity.fromString("64Mi"),
                },
              },
            },
          ],
        },
      },
    },
  });
}
