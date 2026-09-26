import { Codex } from "@openai/codex-sdk";
import { createCodexConfig } from "@shepherdjerred/llm-runtime";
import { z } from "zod";

import {
  AgentOutputSchema,
  AgentOutputWireSchema,
  type AgentOutput,
} from "#src/domain/schemas.ts";
import { agentEnvironment } from "#src/agent/environment.ts";

export async function runCodexTurn(input: {
  prompt: string;
  model: string;
  apiKey: string;
}): Promise<AgentOutput> {
  const codexConfig = createCodexConfig({
    apiKey: input.apiKey,
    modelId: input.model,
    env: agentEnvironment({}),
  });
  const codex = new Codex({
    ...codexConfig.codexOptions,
    config: {
      features: { apps: false, plugins: false, multi_agent: false },
    },
  });
  const thread = codex.startThread({
    approvalPolicy: "never",
    model: codexConfig.routeModelId,
    modelReasoningEffort: "medium",
    networkAccessEnabled: true,
    sandboxMode: "danger-full-access",
    skipGitRepoCheck: false,
    webSearchMode: "disabled",
    workingDirectory: "/workspace",
  });
  const result = await thread.run(input.prompt, {
    outputSchema: z.toJSONSchema(AgentOutputWireSchema),
  });
  const wire = AgentOutputWireSchema.parse(JSON.parse(result.finalResponse));
  return AgentOutputSchema.parse({
    ...wire,
    visualTargets: wire.visualTargets.map((target) => ({
      ...target,
      waitForSelector: target.waitForSelector ?? undefined,
    })),
  });
}
