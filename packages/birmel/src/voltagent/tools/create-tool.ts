/**
 * Tool creation adapter for migrating from Mastra to VoltAgent.
 *
 * Mastra API:
 *   createTool({ id, description, inputSchema, outputSchema, execute: (ctx) => ... })
 *
 * VoltAgent API:
 *   createTool({ name, description, parameters, outputSchema, execute: (args, options) => ... })
 *
 * This adapter accepts Mastra-style tool definitions and adapts them to VoltAgent.
 */
import {
  createTool as voltAgentCreateTool,
  type ToolSchema,
} from "@voltagent/core";
import type { z } from "zod";

/**
 * Mastra-compatible tool options.
 * Accepts either `id` or `name` and either `inputSchema` or `parameters`.
 */
export type MastraCompatibleToolOptions<
  T extends ToolSchema,
  O extends ToolSchema | undefined = undefined,
> = {
  /** Tool ID (Mastra) - will be used as `name` */
  id?: string;
  /** Tool name (VoltAgent) */
  name?: string;
  /** Tool description */
  description: string;
  /** Input schema (Mastra) */
  inputSchema?: T;
  /** Parameters (VoltAgent) */
  parameters?: T;
  /** Output schema */
  outputSchema?: O;
  /**
   * Execute function.
   * Accepts both Mastra-style (single ctx argument) and VoltAgent-style (args, options).
   * The adapter detects which style is being used based on function arity.
   */
  execute: (
    ctx: z.infer<T>,
  ) => Promise<O extends ToolSchema ? z.infer<O> : unknown>;
};

/**
 * Create a VoltAgent tool from a Mastra-compatible definition.
 * This adapter handles the API differences between Mastra and VoltAgent.
 */
export function createTool<
  T extends ToolSchema,
  O extends ToolSchema | undefined = undefined,
>(options: MastraCompatibleToolOptions<T, O>) {
  const name = options.name ?? options.id;
  if (name == null || name.length === 0) {
    throw new Error("Tool must have either `name` or `id`");
  }

  const parameters = options.parameters ?? options.inputSchema;
  if (parameters == null) {
    throw new Error("Tool must have either `parameters` or `inputSchema`");
  }

  // Create VoltAgent tool with adapted options
  if (options.outputSchema != null) {
    return voltAgentCreateTool({
      name,
      description: options.description,
      parameters,
      outputSchema: options.outputSchema,
      execute: async (args) => {
        return await options.execute(args as z.infer<T>);
      },
    });
  }

  // Without output schema
  return voltAgentCreateTool({
    name,
    description: options.description,
    parameters,
    execute: async (args) => {
      return await options.execute(args as z.infer<T>);
    },
  });
}

// Re-export VoltAgent's createTool as well for new tools
export { createTool as createVoltagentTool } from "@voltagent/core";
