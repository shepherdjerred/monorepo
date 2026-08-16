import { createOpenRouterRuntime } from "@shepherdjerred/llm-runtime";
import { getConfig } from "@shepherdjerred/birmel/config/index.ts";
import { metricsRegister } from "@shepherdjerred/birmel/observability/metrics.ts";

let runtime: ReturnType<typeof createOpenRouterRuntime> | undefined;

export function getLlmRuntime(): ReturnType<typeof createOpenRouterRuntime> {
  const config = getConfig();
  runtime ??= createOpenRouterRuntime({
    apiKey: config.openRouter.apiKey,
    service: config.telemetry.serviceName,
    appName: "Birmel",
    metricsRegister,
  });
  return runtime;
}

export function resetLlmRuntime(): void {
  runtime = undefined;
}
