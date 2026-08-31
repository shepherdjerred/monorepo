import { EnvValue, type ISecret } from "cdk8s-plus-31";

export type TemporalRuntimeRole =
  "control" | "home" | "reports" | "infra" | "repo" | "scout";

export function temporalRuntimeEnv(
  serverServiceName: string,
  secret: ISecret,
  role: TemporalRuntimeRole,
  serviceName: string,
): Record<string, EnvValue> {
  return {
    TEMPORAL_ADDRESS: EnvValue.fromValue(`${serverServiceName}:7233`),
    TEMPORAL_NAMESPACE: EnvValue.fromValue("prod"),
    TEMPORAL_LEGACY_NAMESPACE: EnvValue.fromValue("default"),
    TEMPORAL_METRICS_ADDRESS: EnvValue.fromValue("0.0.0.0:9464"),
    TEMPORAL_WORKER_ROLE: EnvValue.fromValue(role),
    ENVIRONMENT: EnvValue.fromValue("production"),
    TELEMETRY_ENABLED: EnvValue.fromValue("true"),
    OTLP_ENDPOINT: EnvValue.fromValue(
      "http://tempo.tempo.svc.cluster.local:4318",
    ),
    TELEMETRY_SERVICE_NAME: EnvValue.fromValue(serviceName),
    SENTRY_DSN: EnvValue.fromSecretValue({ secret, key: "SENTRY_DSN" }),
  };
}
