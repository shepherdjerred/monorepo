import {
  createLlmRuntime,
  providerCredentialsFromEnv,
} from "@shepherdjerred/llm-runtime";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { metricsRegister } from "@shepherdjerred/birmel/observability/metrics.ts";

let runtime: ReturnType<typeof createLlmRuntime> | undefined;

export function getLlmRuntime(): ReturnType<typeof createLlmRuntime> {
  const config = getConfig();
  runtime ??= createLlmRuntime({
    credentials: providerCredentialsFromEnv(),
    service: config.telemetry.serviceName,
    appName: "Birmel",
    metricsRegister,
  });
  return runtime;
}

export function setLlmRuntime(
  nextRuntime: ReturnType<typeof createLlmRuntime> | undefined,
): void {
  runtime = nextRuntime;
}

export function resetLlmRuntime(): void {
  runtime = undefined;
}
