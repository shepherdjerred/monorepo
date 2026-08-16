import {
  createOpenRouterRuntime,
  type OpenRouterRuntime,
} from "@shepherdjerred/llm-runtime";

export type FleetModel = {
  id: string;
  languageModel: ReturnType<OpenRouterRuntime["languageModel"]>;
  runtime: OpenRouterRuntime;
};

export function resolveFleetModel(
  modelId: string,
  apiKey: string | undefined = Bun.env["OPENROUTER_API_KEY"],
): FleetModel {
  if (apiKey === undefined || apiKey.trim() === "") {
    throw new Error("OPENROUTER_API_KEY is required for PR Fleet");
  }
  const runtime = createOpenRouterRuntime({
    apiKey,
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
