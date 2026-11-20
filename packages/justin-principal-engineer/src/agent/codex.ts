import { Codex } from "@openai/codex-sdk";
import { createCodexConfig } from "@shepherdjerred/llm-runtime";
import { z } from "zod";

import {
  AgentOutputSchema,
  AgentOutputWireSchema,
  type AgentOutput,
} from "#src/domain/schemas.ts";
import { agentEnvironment } from "#src/agent/environment.ts";
import type { AgentProgress } from "#src/agent/progress.ts";

export async function runCodexTurn(input: {
  prompt: string;
  model: string;
  apiKey: string;
  onProgress: (progress: AgentProgress) => void;
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
  const { events } = await thread.runStreamed(input.prompt, {
    outputSchema: z.toJSONSchema(AgentOutputWireSchema),
  });
  let finalResponse: string | null = null;
  let completed = false;
  for await (const event of events) {
    switch (event.type) {
      case "turn.started":
        input.onProgress({ kind: "turn_started" });
        break;
      case "turn.completed":
        completed = true;
        input.onProgress({
          kind: "turn_completed",
          usage: {
            input: event.usage.input_tokens,
            output: event.usage.output_tokens,
            cached_input: event.usage.cached_input_tokens,
          },
        });
        break;
      case "turn.failed":
      case "error":
        input.onProgress({ kind: "turn_failed" });
        throw new Error("Codex reported a failed turn");
      case "item.started":
      case "item.completed":
        if (
          event.type === "item.completed" &&
          event.item.type === "agent_message"
        ) {
          finalResponse = event.item.text;
        }
        if (
          event.item.type === "command_execution" ||
          event.item.type === "file_change" ||
          event.item.type === "mcp_tool_call"
        ) {
          input.onProgress({
            kind:
              event.type === "item.started" ? "item_started" : "item_completed",
            item: event.item.type,
          });
        }
        break;
      case "thread.started":
      case "item.updated":
        break;
    }
  }
  if (!completed || finalResponse === null)
    throw new Error("Codex did not complete a structured turn");
  const wire = AgentOutputWireSchema.parse(JSON.parse(finalResponse));
  return AgentOutputSchema.parse({
    ...wire,
    visualTargets: wire.visualTargets.map((target) => ({
      ...target,
      waitForSelector: target.waitForSelector ?? undefined,
    })),
  });
}
