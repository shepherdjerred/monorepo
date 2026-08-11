import {
  AgentTaskInputV2Schema,
  type AgentTaskInput,
} from "#shared/agent-task.ts";

const BLOCK_START = "<!-- temporal-agent-task";
const BLOCK_END = "-->";

function extractBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  let searchFrom = 0;

  while (searchFrom < markdown.length) {
    const start = markdown.indexOf(BLOCK_START, searchFrom);
    if (start === -1) break;
    const jsonStart = start + BLOCK_START.length;
    const end = markdown.indexOf(BLOCK_END, jsonStart);
    if (end === -1) {
      throw new Error(`Unclosed ${BLOCK_START} block`);
    }
    blocks.push(markdown.slice(jsonStart, end).trim());
    searchFrom = end + BLOCK_END.length;
  }

  if (blocks.length === 0) {
    throw new Error(`No ${BLOCK_START} block found`);
  }
  return blocks;
}

export function parseAgentTaskInputsFromMarkdown(
  markdown: string,
): AgentTaskInput[] {
  return extractBlocks(markdown).map((block) =>
    AgentTaskInputV2Schema.parse(JSON.parse(block)),
  );
}
