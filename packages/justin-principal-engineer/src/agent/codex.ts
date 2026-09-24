import { Codex } from "@openai/codex-sdk";
import { createCodexConfig } from "@shepherdjerred/llm-runtime";
import { z } from "zod";

import { AgentOutputSchema, type AgentOutput } from "#src/domain/schemas.ts";
import { agentEnvironment } from "#src/agent/environment.ts";

export async function runCodexTurn(input: {
  prompt: string;
  model: string;
  apiKey: string;
}): Promise<AgentOutput> {
  const openRouter = createCodexConfig({
    apiKey: input.apiKey,
    modelId: input.model,
    env: agentEnvironment({}),
  });
  const codex = new Codex({
    ...openRouter.codexOptions,
    config: {
      ...openRouter.providerConfig,
      features: { apps: false, plugins: false, multi_agent: false },
    },
  });
  const thread = codex.startThread({
    approvalPolicy: "never",
    model: openRouter.routeModelId,
    modelReasoningEffort: "medium",
    networkAccessEnabled: true,
    sandboxMode: "danger-full-access",
    skipGitRepoCheck: false,
    webSearchMode: "disabled",
    workingDirectory: "/workspace",
  });
  const result = await thread.run(input.prompt, {
    outputSchema: z.toJSONSchema(AgentOutputSchema),
  });
  return AgentOutputSchema.parse(JSON.parse(result.finalResponse));
}
