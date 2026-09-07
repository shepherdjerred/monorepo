import { registeredTools, toolsToRecord } from "./tool-sets.ts";

const ids = registeredTools.map(({ id }) => id);
if (new Set(ids).size !== ids.length) {
  throw new Error("Birmel tool registry contains duplicate tool IDs");
}

export const allTools = toolsToRecord(registeredTools);
