import {
  createLlmRuntime,
  providerCredentialsFromEnv,
  type LlmRuntime,
} from "@shepherdjerred/llm-runtime";
import configuration from "#src/configuration.ts";
import { registry } from "#src/metrics/registry.ts";

let cachedRuntime: LlmRuntime | undefined;

export function getLlmRuntime(): LlmRuntime | undefined {
  if (!configuration.inferenceConfigured) return undefined;
  cachedRuntime ??= createLlmRuntime({
    credentials: providerCredentialsFromEnv(),
    service: "scout-for-lol-backend",
    appName: "Scout for LoL",
    metricsRegister: registry,
  });
  return cachedRuntime;
}

export function resetLlmRuntimeForTests(): void {
  cachedRuntime = undefined;
}
