import { EnvValue, type ISecret } from "cdk8s-plus-31";
import type { Construct } from "constructs";
import { consumedBucket, platformModel } from "homelab/src/platform-model.ts";
import type { OnePasswordItem } from "@shepherdjerred/homelab/cdk8s/generated/imports/onepassword.com.ts";
import { onePasswordSecret } from "@shepherdjerred/homelab/cdk8s/src/misc/onepassword-vault.ts";
import { OTLP_GATEWAY_BASE_URL } from "@shepherdjerred/homelab/cdk8s/src/misc/otlp.ts";

/**
 * Environment blocks every first-party workload repeats: the feature-flag
 * client bootstrap, the trace exporter, Bugsink error reporting and the shared
 * SeaweedFS S3 credentials.
 *
 * A container's environment renders as a list in the order its variables were
 * declared, so the order of the keys each preset returns is part of what it
 * renders. Where the existing workloads disagree on that order the preset takes
 * it as a parameter instead of picking a winner: adopting a preset must not
 * change a rendered manifest. Converging the dialects is a separate,
 * per-service change.
 */

/** Flipt's in-cluster evaluation endpoint. */
export const FLIPT_URL =
  "http://flipt-flipt-service.flipt.svc.cluster.local:8080";

type FliptKey = "FLIPT_NAMESPACE" | "FLIPT_ENVIRONMENT" | "FLIPT_URL";

/** The order a workload declares its three Flipt variables in. */
export type FliptEnvOrder = readonly [FliptKey, FliptKey, FliptKey];

const FLIPT_ENV_ORDER: FliptEnvOrder = [
  "FLIPT_NAMESPACE",
  "FLIPT_ENVIRONMENT",
  "FLIPT_URL",
];

/**
 * Bootstrap for the feature-flag client: `FEATURE_FLAGS_MODE=flipt` followed by
 * the Flipt namespace, environment and URL. These cannot come from a flag.
 *
 * `order` exists only to reproduce a workload's existing declaration order;
 * new workloads leave it unset.
 */
export function fliptEnv(props: {
  namespace: string;
  environment: string;
  order?: FliptEnvOrder;
}): Record<string, EnvValue> {
  const values: Record<FliptKey, string> = {
    FLIPT_NAMESPACE: props.namespace,
    FLIPT_ENVIRONMENT: props.environment,
    FLIPT_URL,
  };
  const env: Record<string, EnvValue> = {
    FEATURE_FLAGS_MODE: EnvValue.fromValue("flipt"),
  };
  for (const key of props.order ?? FLIPT_ENV_ORDER) {
    env[key] = EnvValue.fromValue(values[key]);
  }
  return env;
}

/**
 * The trace exporter for the `TELEMETRY_*` dialect: tracing on, spans sent to
 * the in-cluster OTLP gateway.
 *
 * Without `serviceName` only `TELEMETRY_ENABLED` and `OTLP_ENDPOINT` are
 * returned, for a base environment several workloads extend with their own
 * name. `serviceNameFirst` reproduces the workloads that declare
 * `TELEMETRY_SERVICE_NAME` before `OTLP_ENDPOINT`; new workloads leave it
 * unset.
 */
export function telemetryEnv(
  props: { serviceName?: string; serviceNameFirst?: boolean } = {},
): Record<string, EnvValue> {
  const enabled = { TELEMETRY_ENABLED: EnvValue.fromValue("true") };
  const endpoint = { OTLP_ENDPOINT: EnvValue.fromValue(OTLP_GATEWAY_BASE_URL) };
  if (props.serviceName === undefined) return { ...enabled, ...endpoint };
  const serviceName = {
    TELEMETRY_SERVICE_NAME: EnvValue.fromValue(props.serviceName),
  };
  return props.serviceNameFirst === true
    ? { ...enabled, ...serviceName, ...endpoint }
    : { ...enabled, ...endpoint, ...serviceName };
}

/**
 * Bugsink error reporting. The DSN is always the `BUGSINK_DSN` field of the
 * workload's own secret; a missing field fails the pod at start.
 *
 * Most workloads read their environment and release from elsewhere and need
 * only the DSN. `report` adds the explicit `BUGSINK_ENABLED`,
 * `BUGSINK_ENVIRONMENT` and `BUGSINK_RELEASE` variables for those that
 * configure them through the environment.
 */
export function bugsinkEnv(
  secret: ISecret,
  report?: { environment: string; release: string },
): Record<string, EnvValue> {
  const dsn = {
    BUGSINK_DSN: EnvValue.fromSecretValue({ secret, key: "BUGSINK_DSN" }),
  };
  if (report === undefined) return dsn;
  return {
    BUGSINK_ENABLED: EnvValue.fromValue("true"),
    ...dsn,
    BUGSINK_ENVIRONMENT: EnvValue.fromValue(report.environment),
    BUGSINK_RELEASE: EnvValue.fromValue(report.release),
  };
}

/** The 1Password item holding the shared SeaweedFS S3 access key pair. */
const SEAWEEDFS_S3_ITEM_ID = "vet52jaeh75chsalu6lulugium";

/**
 * The shared SeaweedFS S3 gateway and the access key pair first-party
 * workloads use against it.
 *
 * Kubernetes cannot reference a Secret across namespaces, so each consumer
 * mirrors the same 1Password item into its own namespace with `item` and reads
 * it with `credentialsEnv`.
 */
export const seaweedfsS3 = {
  /** The in-cluster S3 endpoint; clients must use path-style addressing. */
  endpoint: platformModel.seaweedfs.s3InClusterEndpoint,

  /** SeaweedFS ignores the region, but AWS SDKs refuse to sign without one. */
  region: "us-east-1",

  /**
   * The variable that names a bucket, with the bucket the platform model
   * declares for it: the one `namespace` consumes, or without a namespace the
   * one every consumer of `env` shares.
   */
  bucketEnv(env: string, namespace?: string): Record<string, EnvValue> {
    return {
      [env]: EnvValue.fromValue(
        consumedBucket(namespace === undefined ? { env } : { env, namespace }),
      ),
    };
  },

  /**
   * Mirror the credentials item into the scope's namespace. `name` sets the
   * resulting Secret's name; without it cdk8s derives one from `id`.
   */
  item(scope: Construct, id: string, name?: string): OnePasswordItem {
    return onePasswordSecret(
      scope,
      id,
      SEAWEEDFS_S3_ITEM_ID,
      name === undefined ? undefined : { name },
    );
  },

  /**
   * The item's `SEAWEEDFS_*` fields under the `AWS_*` names every S3 client
   * reads.
   */
  credentialsEnv(secret: ISecret): Record<string, EnvValue> {
    return {
      AWS_ACCESS_KEY_ID: EnvValue.fromSecretValue({
        secret,
        key: "SEAWEEDFS_ACCESS_KEY_ID",
      }),
      AWS_SECRET_ACCESS_KEY: EnvValue.fromSecretValue({
        secret,
        key: "SEAWEEDFS_SECRET_ACCESS_KEY",
      }),
    };
  },
};
