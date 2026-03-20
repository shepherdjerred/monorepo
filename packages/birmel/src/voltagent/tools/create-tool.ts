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
   * Accepts Mastra-style (single ctx argument).
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

  // Create VoltAgent tool with adapted options.
  // Pass the original execute directly since it already accepts z.infer<T>.
  if (options.outputSchema != null) {
    return voltAgentCreateTool({
      name,
      description: options.description,
      parameters,
      outputSchema: options.outputSchema,
      execute: options.execute,
    });
  }

  // Without output schema
  return voltAgentCreateTool({
    name,
    description: options.description,
    parameters,
    execute: options.execute,
  });
}
