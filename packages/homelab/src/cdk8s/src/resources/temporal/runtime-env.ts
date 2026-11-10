import { EnvValue, type ISecret } from "cdk8s-plus-31";
import {
  telemetryEnv,
  bugsinkEnv,
} from "@shepherdjerred/homelab/cdk8s/src/misc/first-party/runtime-env.ts";

export type TemporalRuntimeRole =
  "billing" | "control" | "home" | "reports" | "infra" | "repo" | "scout";

export function temporalRuntimeEnv(
  serverServiceName: string,
  secret: ISecret,
  role: TemporalRuntimeRole,
  serviceName: string,
): Record<string, EnvValue> {
  return {
    TEMPORAL_ADDRESS: EnvValue.fromValue(`${serverServiceName}:7233`),
    TEMPORAL_NAMESPACE: EnvValue.fromValue("prod"),
    TEMPORAL_METRICS_ADDRESS: EnvValue.fromValue("0.0.0.0:9464"),
    TEMPORAL_WORKER_ROLE: EnvValue.fromValue(role),
    ENVIRONMENT: EnvValue.fromValue("production"),
    ...telemetryEnv({ serviceName }),
    ...bugsinkEnv(secret),
  };
}
