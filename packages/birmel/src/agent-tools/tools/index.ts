import {
  automationToolSet,
  editorToolSet,
  messagingToolSet,
  moderationToolSet,
  musicToolSet,
  serverToolSet,
  toolsToRecord,
} from "./tool-sets.ts";

const registeredTools = [
  ...messagingToolSet,
  ...serverToolSet,
  ...moderationToolSet,
  ...musicToolSet,
  ...automationToolSet,
  ...editorToolSet,
];

const ids = registeredTools.map(({ id }) => id);
if (new Set(ids).size !== ids.length) {
  throw new Error("Birmel tool registry contains duplicate tool IDs");
}

export const allTools = toolsToRecord(registeredTools);
