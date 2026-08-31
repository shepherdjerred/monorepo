import type { Chart } from "cdk8s";
import { Size } from "cdk8s";
import {
  ConfigMap as ConfigMapResource,
  Cpu,
  type Deployment,
  EnvFieldPaths,
  EnvValue,
  type ISecret,
  Volume,
} from "cdk8s-plus-31";
import { withCommonProps } from "@shepherdjerred/homelab/cdk8s/src/misc/common.ts";
import {
  TEMPORAL_POSTGRES_TLS_CA_FILE,
  TEMPORAL_POSTGRES_TLS_SERVER_NAME,
} from "@shepherdjerred/homelab/cdk8s/src/resources/postgres/temporal-db-tls.ts";

// `temporal-server start` resolves its config directory relative to the
// image's working directory (/etc/temporal), so it reads
// <cwd>/config/<env>.yaml, and the default env is "development".
export const TEMPORAL_SERVER_CONFIG_DIRECTORY = "/etc/temporal/config";
export const TEMPORAL_SERVER_CONFIG_FILE = "development.yaml";

const TEMPORAL_SERVER_POSTGRES_TLS_DIRECTORY = "/etc/temporal/postgres-tls";
export const TEMPORAL_SERVER_POSTGRES_CA_PATH = `${TEMPORAL_SERVER_POSTGRES_TLS_DIRECTORY}/${TEMPORAL_POSTGRES_TLS_CA_FILE}`;
export { TEMPORAL_SERVER_POSTGRES_TLS_DIRECTORY };

const TEMPORAL_SERVER_DYNAMIC_CONFIG_DIRECTORY = "/etc/temporal/dynamic-config";
export const TEMPORAL_SERVER_DYNAMIC_CONFIG_PATH = `${TEMPORAL_SERVER_DYNAMIC_CONFIG_DIRECTORY}/dynamic-config.yaml`;
export { TEMPORAL_SERVER_DYNAMIC_CONFIG_DIRECTORY };

// Substituted by the render init container; never real values at rest. The
// password lives in the postgres-operator Secret, and the pod IP is only
// known once the pod is scheduled.
export const POSTGRES_PASSWORD_PLACEHOLDER = "__POSTGRES_PASSWORD__";
export const POD_IP_PLACEHOLDER = "__POD_IP__";

/**
 * The complete Temporal server configuration.
 *
 * `temporalio/server` is not `temporalio/auto-setup`: it ships no
 * config_template.yaml, its entrypoint is a bare `exec temporal-server start`
 * with no dockerize step, and its config loader performs NO environment
 * substitution -- `{{ .Env.X }}` and `${"$"}{X}` are both read literally. Every
 * value therefore has to be in this file before the server starts, and the
 * two that cannot be known at synth time are substituted by the init
 * container.
 *
 * This content was not hand-authored. It was captured from the configuration
 * dockerize had already rendered inside the running cluster, then changed in
 * exactly three ways: Postgres is addressed by its fully-qualified name and
 * its certificate is verified against the stable CA (the previous rendering
 * disabled host verification outright), and bindOnIP no longer hardcodes the
 * IP of whichever pod happened to render it.
 *
 * numHistoryShards is IMMUTABLE for the life of a cluster. 512 is what this
 * cluster was created with; changing it does not fail loudly, it corrupts the
 * deployment.
 */
export const TEMPORAL_SERVER_CONFIG = `log:
    stdout: true
    level: info

persistence:
    numHistoryShards: 512
    defaultStore: default
    visibilityStore: visibility
    datastores:
        default:
            sql:
                pluginName: "postgres12"
                databaseName: "temporal"
                connectAddr: "${TEMPORAL_POSTGRES_TLS_SERVER_NAME}:5432"
                connectProtocol: "tcp"
                user: "temporal"
                password: "__POSTGRES_PASSWORD__"
                maxConns: 20
                maxIdleConns: 20
                maxConnLifetime: 1h
                tls:
                    enabled: true
                    caFile: "${TEMPORAL_SERVER_POSTGRES_CA_PATH}"
                    enableHostVerification: true
                    serverName: "${TEMPORAL_POSTGRES_TLS_SERVER_NAME}"
        visibility:
            sql:
                
                
                
                
                
                
                
                
                pluginName: "postgres12"
                databaseName: "temporal_visibility"
                connectAddr: "${TEMPORAL_POSTGRES_TLS_SERVER_NAME}:5432"
                connectProtocol: "tcp"
                user: "temporal"
                password: "__POSTGRES_PASSWORD__"
                maxConns: 10
                maxIdleConns: 10
                maxConnLifetime: 1h
                tls:
                    enabled: true
                    caFile: "${TEMPORAL_SERVER_POSTGRES_CA_PATH}"
                    enableHostVerification: true
                    serverName: "${TEMPORAL_POSTGRES_TLS_SERVER_NAME}"

global:
    membership:
        maxJoinDuration: 30s
        broadcastAddress: "__POD_IP__"
    pprof:
        port: 0
    tls:
        refreshInterval: 0s
        expirationChecks:
            warningWindow: 0s
            errorWindow: 0s
            checkInterval: 0s
        internode:
            # This server section configures the TLS certificate that internal temporal
            # cluster nodes (history, matching, and internal-frontend) present to other
            # clients within the Temporal Cluster.
            server:
                requireClientAuth: false

                certFile: 
                keyFile: 

                certData: 
                keyData: 

            # This client section is used to configure the TLS clients within
            # the Temporal Cluster that connect to an Internode (history, matching, or
            # internal-frontend)
            client:
                serverName: 
                disableHostVerification: false
        frontend:
            # This server section configures the TLS certificate that the Frontend
            # server presents to external clients.
            server:
                requireClientAuth: false
                certFile: 
                keyFile: 

                certData: 
                keyData: 

            # This client section is used to configure the TLS clients within
            # the Temporal Cluster (specifically the Worker role) that connect to the Frontend service
            client:
                serverName: 
                disableHostVerification: false
    metrics:
        prometheus:
            timerType: histogram
            listenAddress: "0.0.0.0:9090"
    authorization:
        jwtKeyProvider:
            keySourceURIs:
            refreshInterval: 1m
        permissionsClaimName: permissions
        permissionsRegex: 
        authorizer: 
        claimMapper: 
services:
    frontend:
        rpc:
            grpcPort: 7233
            membershipPort: 6933
            bindOnIP: "0.0.0.0"
            httpPort: 7243

    matching:
        rpc:
            grpcPort: 7235
            membershipPort: 6935
            bindOnIP: "0.0.0.0"

    history:
        rpc:
            grpcPort: 7234
            membershipPort: 6934
            bindOnIP: "0.0.0.0"

    worker:
        rpc:
            grpcPort: 7239
            membershipPort: 6939
            bindOnIP: "0.0.0.0"

clusterMetadata:
    enableGlobalNamespace: false
    failoverVersionIncrement: 10
    masterClusterName: "active"
    currentClusterName: "active"
    clusterInformation:
        active:
            enabled: true
            initialFailoverVersion: 1
            rpcName: "frontend"
            rpcAddress: 127.0.0.1:7233
            httpAddress: 127.0.0.1:7243

dcRedirectionPolicy:
    policy: "noop"

archival:
  history:
    state: "enabled"
    enableRead: true
    provider:
      filestore:
        fileMode: "0666"
        dirMode: "0766"
  visibility:
    state: "enabled"
    enableRead: true
    provider:
      filestore:
        fileMode: "0666"
        dirMode: "0766"

namespaceDefaults:
  archival:
    history:
      state: "disabled"
      URI: "file:///tmp/temporal_archival/development"
    visibility:
      state: "disabled"
      URI: "file:///tmp/temporal_vis_archival/development"


dynamicConfigClient:
    filepath: "${TEMPORAL_SERVER_DYNAMIC_CONFIG_PATH}"
    pollInterval: "60s"
`;

export type ConfigRenderProps = {
  serverImage: string;
  postgresSecret: ISecret;
  configVolume: Volume;
  uid: number;
  gid: number;
};

export function addConfigRenderInitContainer(
  chart: Chart,
  deployment: Deployment,
  props: ConfigRenderProps,
) {
  const {
    serverImage,
    postgresSecret,
    configVolume,
    uid: UID,
    gid: GID,
  } = props;
  // temporalio/server ships no configuration and its entrypoint performs no
  // rendering: it is a bare `exec temporal-server start`, and the config
  // loader does not expand environment variables. The complete config is
  // therefore supplied as a ConfigMap, and this init container fills in the
  // only two values that cannot exist at synth time -- the database password,
  // which belongs in a Secret, and the pod IP, which membership advertises
  // and which is not known until the pod is scheduled.
  const serverConfigMap = new ConfigMapResource(
    chart,
    "temporal-server-config",
    {
      metadata: { name: "temporal-server-config" },
      data: { [TEMPORAL_SERVER_CONFIG_FILE]: TEMPORAL_SERVER_CONFIG },
    },
  );
  const configTemplateVolume = Volume.fromConfigMap(
    chart,
    "temporal-server-config-template-volume",
    serverConfigMap,
    { name: "config-template" },
  );

  // Written with $VAR and never ${VAR}: this is an ordinary template literal,
  // so a braced form would be interpolated by TypeScript instead of reaching
  // the shell. `set -u` is what makes a missing variable fail loudly, which
  // is why no default expansion is needed either.
  const RENDER_CONFIG_SCRIPT = `
set -eu

# The password is interpolated into a double-quoted YAML scalar, and awk's
# gsub treats & specially in a replacement. Both are safe only for an
# alphanumeric secret, so refuse anything else rather than emit a config that
# is silently wrong.
case "$POSTGRES_PWD" in
  "") echo "POSTGRES_PWD is empty" >&2; exit 1 ;;
  *[!0-9A-Za-z]*) echo "POSTGRES_PWD has characters this renderer cannot safely interpolate" >&2; exit 1 ;;
esac
case "$POD_IP" in
  "") echo "POD_IP is empty" >&2; exit 1 ;;
  *[!0-9a-fA-F.:]*) echo "POD_IP is not an IP address" >&2; exit 1 ;;
esac

awk -v pw="$POSTGRES_PWD" -v ip="$POD_IP" '{ gsub(/${POSTGRES_PASSWORD_PLACEHOLDER}/, pw); gsub(/${POD_IP_PLACEHOLDER}/, ip); print }' \
  /config-template/${TEMPORAL_SERVER_CONFIG_FILE} > ${TEMPORAL_SERVER_CONFIG_DIRECTORY}/${TEMPORAL_SERVER_CONFIG_FILE}

# A surviving placeholder means the server would start against a config that
# cannot authenticate, so fail here instead.
if grep -qE '${POSTGRES_PASSWORD_PLACEHOLDER}|${POD_IP_PLACEHOLDER}' ${TEMPORAL_SERVER_CONFIG_DIRECTORY}/${TEMPORAL_SERVER_CONFIG_FILE}; then
  echo "config still contains a placeholder after rendering" >&2
  exit 1
fi
`.trim();

  deployment.addInitContainer(
    withCommonProps({
      name: "temporal-server-config-render",
      image: serverImage,
      command: ["/bin/sh", "-c"],
      args: [RENDER_CONFIG_SCRIPT],
      envVariables: {
        POSTGRES_PWD: EnvValue.fromSecretValue({
          secret: postgresSecret,
          key: "password",
        }),
        POD_IP: EnvValue.fromFieldRef(EnvFieldPaths.POD_IP),
      },
      securityContext: {
        user: UID,
        group: GID,
        ensureNonRoot: true,
        readOnlyRootFilesystem: true,
      },
      volumeMounts: [
        {
          path: "/config-template",
          volume: configTemplateVolume,
          readOnly: true,
        },
        { path: TEMPORAL_SERVER_CONFIG_DIRECTORY, volume: configVolume },
      ],
      resources: {
        cpu: { request: Cpu.millis(10), limit: Cpu.millis(100) },
        memory: { request: Size.mebibytes(16), limit: Size.mebibytes(64) },
      },
    }),
  );
}
