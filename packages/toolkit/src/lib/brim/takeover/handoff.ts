import { chmod, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { HistoryMessage, HistoryMessageRole } from "#lib/history/types.ts";
import type { ResolvedTakeoverSession } from "./resolve.ts";
import type { InspectedTerminal } from "./terminal.ts";

export const DEFAULT_DIALOGUE_CHAR_BUDGET = 120_000;

export type PreparedTakeover = {
  readonly sourceProvider: string;
  readonly sourceDisplayName: string;
  readonly historySource: string;
  readonly historyId: number | null;
  readonly sourceId: string;
  readonly title: string;
  readonly cwd: string;
  readonly gitBranch: string | null;
  readonly rawTranscriptPath: string;
  readonly handoffPath: string;
  readonly messageCount: number;
  readonly prompt: string;
  readonly terminal: {
    readonly address: string;
    readonly space: string | null;
    readonly tab: string | null;
  } | null;
};

export type HandoffOptions = {
  readonly outputDir?: string;
  readonly note?: string | null;
  readonly now?: Date;
  readonly maxDialogueChars?: number;
  readonly terminal?: InspectedTerminal | null;
};

type RenderedBlock = {
  readonly role: HistoryMessageRole;
  readonly rawMessageCount: number;
  readonly markdown: string;
};

export function defaultTakeoversDir(home: string = os.homedir()): string {
  return path.join(home, ".toolkit", "takeovers");
}

export function singleLineTitle(title: string): string {
  const collapsed = title.replaceAll(/\s+/gu, " ").trim();
  return collapsed.length > 0 ? collapsed : "Untitled session";
}

export function safeHandoffSlug(title: string, fallback = "session"): string {
  const slug = title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "")
    .slice(0, 48)
    .replaceAll(/-+$/gu, "");
  return slug.length > 0 ? slug : fallback;
}

export function compactUtcTimestamp(now: Date = new Date()): string {
  return now
    .toISOString()
    .replaceAll(/[-:]/gu, "")
    .replace(/\.\d{3}Z$/u, "Z");
}

function collapseConsecutiveNames(names: readonly string[]): string[] {
  const collapsed: string[] = [];
  let current: string | null = null;
  let count = 0;
  const flush = (): void => {
    if (current === null) {
      return;
    }
    collapsed.push(count > 1 ? `${current} (x${String(count)})` : current);
  };
  for (const name of names) {
    if (name === current) {
      count += 1;
    } else {
      flush();
      current = name;
      count = 1;
    }
  }
  flush();
  return collapsed;
}

export function formatToolMarker(
  toolMessages: readonly HistoryMessage[],
): string {
  const named = toolMessages.flatMap((entry) =>
    entry.toolName !== undefined && entry.toolName.trim().length > 0
      ? [entry.toolName.trim()]
      : [],
  );
  if (named.length === 0) {
    const count = toolMessages.length;
    return count > 1
      ? `_Tools used: tool (x${String(count)})_`
      : "_Tools used: tool_";
  }
  return `_Tools used: ${collapseConsecutiveNames(named).join(", ")}_`;
}

function roleHeadingLabel(role: HistoryMessageRole): string {
  switch (role) {
    case "user":
      return "User";
    case "assistant":
      return "Assistant";
    case "tool":
      return "Tool";
    case "unknown":
      return "Message";
  }
}

function formatDialogueTurn(entry: HistoryMessage): string {
  const label = roleHeadingLabel(entry.role);
  const heading =
    entry.createdAt === null
      ? `### ${label}`
      : `### ${label} (${entry.createdAt})`;
  return `${heading}\n\n${entry.text.trim()}`;
}

function buildRenderedBlocks(
  messages: readonly HistoryMessage[],
): RenderedBlock[] {
  const blocks: RenderedBlock[] = [];
  let toolRun: HistoryMessage[] = [];
  const flushTools = (): void => {
    if (toolRun.length === 0) {
      return;
    }
    blocks.push({
      role: "tool",
      rawMessageCount: toolRun.length,
      markdown: formatToolMarker(toolRun),
    });
    toolRun = [];
  };
  for (const entry of messages) {
    if (entry.role === "tool") {
      toolRun.push(entry);
      continue;
    }
    if (entry.text.trim().length === 0) {
      continue;
    }
    flushTools();
    blocks.push({
      role: entry.role,
      rawMessageCount: 1,
      markdown: formatDialogueTurn(entry),
    });
  }
  flushTools();
  return blocks;
}

function openingHeadEndIndex(blocks: readonly RenderedBlock[]): number {
  const firstUser = blocks.findIndex((block) => block.role === "user");
  if (firstUser === -1) {
    return Math.min(1, blocks.length);
  }
  let end = firstUser + 1;
  while (end < blocks.length && blocks[end]?.role === "user") {
    end += 1;
  }
  return end;
}

function omissionMarker(
  omittedMessages: number,
  rawTranscriptPath: string,
): string {
  return `_[... ${String(omittedMessages)} middle messages omitted for length; see raw transcript at ${rawTranscriptPath} if needed ...]_`;
}

function sumRawMessages(blocks: readonly RenderedBlock[]): number {
  let total = 0;
  for (const block of blocks) {
    total += block.rawMessageCount;
  }
  return total;
}

function capSingleMarkdown(markdown: string, maxChars: number): string {
  if (markdown.length <= maxChars) {
    return markdown;
  }
  const ellipsis = "\n\n_[... truncated for length ...]_";
  const sliceBudget = Math.max(64, maxChars - ellipsis.length);
  return `${markdown.slice(0, sliceBudget)}${ellipsis}`;
}

function findTailStartIndex(
  blocks: readonly RenderedBlock[],
  headEnd: number,
  tailBudget: number,
): number {
  let tailStart = blocks.length;
  let usedTailChars = 0;
  for (let index = blocks.length - 1; index >= headEnd; index -= 1) {
    const candidate = blocks[index];
    if (candidate === undefined) {
      continue;
    }
    const separator = tailStart === blocks.length ? 0 : 2;
    if (usedTailChars + separator + candidate.markdown.length > tailBudget) {
      break;
    }
    usedTailChars += separator + candidate.markdown.length;
    tailStart = index;
  }
  return tailStart;
}

function formatFallbackLastTurn(options: {
  readonly blocks: readonly RenderedBlock[];
  readonly headEnd: number;
  readonly headMarkdown: string;
  readonly tailBudget: number;
  readonly rawTranscriptPath: string;
}): string {
  const lastBlock = options.blocks.at(-1);
  if (lastBlock === undefined) {
    return options.headMarkdown;
  }
  const omitted = sumRawMessages(options.blocks.slice(options.headEnd, -1));
  const trimmedLast = capSingleMarkdown(lastBlock.markdown, options.tailBudget);
  return omitted > 0
    ? [
        options.headMarkdown,
        omissionMarker(omitted, options.rawTranscriptPath),
        trimmedLast,
      ].join("\n\n")
    : [options.headMarkdown, trimmedLast].join("\n\n");
}

function boundRenderedDialogue(
  blocks: readonly RenderedBlock[],
  rawTranscriptPath: string,
  maxChars: number,
): string {
  if (blocks.length === 0) {
    return "_No dialogue messages recorded._";
  }
  const full = blocks.map((block) => block.markdown).join("\n\n");
  if (full.length <= maxChars) {
    return full;
  }

  const headEnd = openingHeadEndIndex(blocks);
  const maxHeadBudget = Math.max(256, Math.floor(maxChars * 0.6));
  const rawHead = blocks
    .slice(0, headEnd)
    .map((block) => block.markdown)
    .join("\n\n");
  const headMarkdown = capSingleMarkdown(rawHead, maxHeadBudget);

  const totalRemainingMessages = sumRawMessages(blocks.slice(headEnd));
  const worstCaseMarker = omissionMarker(
    Math.max(1, totalRemainingMessages),
    rawTranscriptPath,
  );
  const tailBudget = Math.max(
    128,
    maxChars - headMarkdown.length - worstCaseMarker.length - 4,
  );
  const tailStart = findTailStartIndex(blocks, headEnd, tailBudget);

  if (tailStart === blocks.length && blocks.length > headEnd) {
    return formatFallbackLastTurn({
      blocks,
      headEnd,
      headMarkdown,
      tailBudget,
      rawTranscriptPath,
    });
  }

  const omittedCount = sumRawMessages(blocks.slice(headEnd, tailStart));
  const tailMarkdown = blocks
    .slice(tailStart)
    .map((block) => block.markdown)
    .join("\n\n");
  const parts = [
    headMarkdown,
    ...(omittedCount > 0
      ? [omissionMarker(omittedCount, rawTranscriptPath)]
      : []),
    ...(tailMarkdown.length > 0 ? [tailMarkdown] : []),
  ];
  return parts.join("\n\n");
}

export function renderHandoffMarkdown(
  session: ResolvedTakeoverSession,
  options: {
    readonly note?: string | null;
    readonly maxDialogueChars?: number;
  } = {},
): string {
  const title = singleLineTitle(session.title);
  const maxDialogueChars =
    options.maxDialogueChars ?? DEFAULT_DIALOGUE_CHAR_BUDGET;
  const idLabel =
    session.historyId === null ? "unindexed" : String(session.historyId);
  const metadataLines = [
    `- **Source provider:** ${session.sourceDisplayName} (\`${session.sourceProvider}\`)`,
    `- **History session:** \`${session.historySource}\` (ID: ${idLabel}, source ID: \`${session.sourceId}\`)`,
    `- **Workspace:** \`${session.cwd}\``,
    ...(session.gitBranch === null
      ? []
      : [`- **Git branch:** \`${session.gitBranch}\``]),
    `- **Created:** ${session.createdAt}`,
    `- **Last updated:** ${session.updatedAt}`,
    `- **Messages:** ${String(session.messages.length)}`,
    `- **Raw transcript:** \`${session.rawTranscriptPath}\``,
  ];

  const sections = [`# Session Handoff: ${title}`, metadataLines.join("\n")];
  const trimmedNote = options.note?.trim() ?? "";
  if (trimmedNote.length > 0) {
    sections.push(`## User Handoff Note\n\n${trimmedNote}`);
  }
  const blocks = buildRenderedBlocks(session.messages);
  const dialogue = boundRenderedDialogue(
    blocks,
    session.rawTranscriptPath,
    maxDialogueChars,
  );
  sections.push(`## Conversation Transcript\n\n${dialogue}`);
  return `${sections.join("\n\n")}\n`;
}

export function buildTakeoverPrompt(options: {
  readonly sourceDisplayName: string;
  readonly title: string;
  readonly handoffPath: string;
  readonly rawTranscriptPath: string;
  readonly note?: string | null;
}): string {
  const cleanTitle = singleLineTitle(options.title);
  const base = [
    `You are taking over an interrupted ${options.sourceDisplayName} session ("${cleanTitle}") after a usage limit.`,
    `Read the session handoff transcript at ${options.handoffPath} first (raw source transcript: ${options.rawTranscriptPath}), then inspect \`git status\` and \`git diff\` to verify the live workspace state before making changes. Do not repeat completed work. Continue the task from where the previous agent stopped.`,
  ].join("\n");
  const trimmedNote = options.note?.trim() ?? "";
  return trimmedNote.length > 0
    ? `${base}\n\nUser note for this handoff:\n${trimmedNote}`
    : base;
}

async function allocateHandoffPath(
  outputDir: string,
  stem: string,
): Promise<string> {
  const primary = path.join(outputDir, `${stem}.md`);
  if (!(await Bun.file(primary).exists())) {
    return primary;
  }
  let suffix = 2;
  for (;;) {
    const candidate = path.join(outputDir, `${stem}-${String(suffix)}.md`);
    if (!(await Bun.file(candidate).exists())) {
      return candidate;
    }
    suffix += 1;
  }
}

export async function prepareTakeover(
  session: ResolvedTakeoverSession,
  options: HandoffOptions = {},
): Promise<PreparedTakeover> {
  const outputDir = path.resolve(options.outputDir ?? defaultTakeoversDir());
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  await chmod(outputDir, 0o700);

  const timestamp = compactUtcTimestamp(options.now ?? new Date());
  const slug = safeHandoffSlug(
    session.title,
    safeHandoffSlug(session.sourceId),
  );
  const stem = `${timestamp}-${session.historySource}-${slug}`;
  const handoffPath = await allocateHandoffPath(outputDir, stem);

  const markdown = renderHandoffMarkdown(session, {
    ...(options.note === undefined ? {} : { note: options.note }),
    ...(options.maxDialogueChars === undefined
      ? {}
      : { maxDialogueChars: options.maxDialogueChars }),
  });
  await Bun.write(handoffPath, markdown, { mode: 0o600 });
  await chmod(handoffPath, 0o600);

  const title = singleLineTitle(session.title);
  const prompt = buildTakeoverPrompt({
    sourceDisplayName: session.sourceDisplayName,
    title,
    handoffPath,
    rawTranscriptPath: session.rawTranscriptPath,
    ...(options.note === undefined ? {} : { note: options.note }),
  });

  const terminal = options.terminal ?? null;
  return {
    sourceProvider: session.sourceProvider,
    sourceDisplayName: session.sourceDisplayName,
    historySource: session.historySource,
    historyId: session.historyId,
    sourceId: session.sourceId,
    title,
    cwd: session.cwd,
    gitBranch: session.gitBranch,
    rawTranscriptPath: session.rawTranscriptPath,
    handoffPath,
    messageCount: session.messages.length,
    prompt,
    terminal:
      terminal === null
        ? null
        : {
            address: terminal.address,
            space: terminal.space,
            tab: terminal.tab,
          },
  };
}
