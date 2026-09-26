import {
  createLlmRuntime,
  providerCredentialsFromEnv,
  type LlmRuntime,
} from "@shepherdjerred/llm-runtime";

export type FleetModel = {
  id: string;
  languageModel: ReturnType<LlmRuntime["languageModel"]>;
  runtime: LlmRuntime;
};

export function resolveFleetModel(
  modelId: string,
  credentials = providerCredentialsFromEnv(),
): FleetModel {
  const runtime = createLlmRuntime({
    credentials,
    service: "pr-fleet-controller",
    appName: "PR Fleet Controller",
  });
  return {
    id: modelId,
    languageModel: runtime.languageModel(modelId, [
      "tools",
      "structuredOutputs",
    ]),
    runtime,
  };
}
