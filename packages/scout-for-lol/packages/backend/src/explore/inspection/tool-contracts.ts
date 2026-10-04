import { z } from "zod";
import type { ToolSet } from "ai";

const contracts = new Map<string, { input: z.ZodType; output: z.ZodType }>();

/** Use the same contracts for execution and inspection, including gated tools. */
export function registerExploreToolContracts<T extends ToolSet>(tools: T): T {
  for (const [name, definition] of Object.entries(tools)) {
    if (
      !(definition.inputSchema instanceof z.ZodType) ||
      !(definition.outputSchema instanceof z.ZodType)
    ) {
      throw new TypeError(
        `Explore tool ${name} needs Zod input and output contracts`,
      );
    }
    contracts.set(name, {
      input: definition.inputSchema,
      output: definition.outputSchema,
    });
  }
  return tools;
}

export function inspectRegisteredTool(
  name: string,
  direction: "input" | "output",
  value: unknown,
) {
  const contract = contracts.get(name);
  return contract === undefined
    ? null
    : z.json().parse(contract[direction].parse(value));
}
