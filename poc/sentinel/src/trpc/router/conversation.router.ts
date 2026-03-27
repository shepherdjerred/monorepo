import { z } from "zod";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { router, publicProcedure } from "@shepherdjerred/sentinel/trpc/trpc.ts";
import type { ConversationEntry } from "@shepherdjerred/sentinel/types/history.ts";

const CONVERSATIONS_DIR = path.join(
  import.meta.dirname,
  "../../../data/conversations",
);

type ConversationFile = {
  filename: string;
  agent: string;
  sessionId: string;
  timestamp: string;
};

type AgentGroup = {
  agent: string;
  files: ConversationFile[];
};

function parseFilename(
  filename: string,
  agent: string,
): ConversationFile | null {
  // Format: {date}T{time}_{sessionId}.jsonl where time uses dashes instead of colons
  // Example: 2026-02-23T04-53-57.131Z_uuid.jsonl
  const match = /^(\d{4}-\d{2}-\d{2}T)([\d-]+\.\d+Z)_([^_]+)\.jsonl$/.exec(
    filename,
  );
  if (match == null) return null;
  const datePart = match[1];
  const timePart = match[2];
  const sessionId = match[3];
  if (datePart == null || timePart == null || sessionId == null) return null;
  // Only restore colons in the time portion (after the T)
  const timestamp = `${datePart}${timePart.replaceAll("-", ":")}`;
  return { filename, agent, sessionId, timestamp };
}

async function getAllConversationFiles(): Promise<ConversationFile[]> {
  const files: ConversationFile[] = [];

  try {
    const entries = await readdir(CONVERSATIONS_DIR, { withFileTypes: true });

    const dirEntries = entries.filter((e) => e.isDirectory());
    const flatFiles = entries.filter(
      (e) => !e.isDirectory() && e.name.endsWith(".jsonl"),
    );

    for (const dir of dirEntries) {
      const agentDir = path.join(CONVERSATIONS_DIR, dir.name);
      const allAgentFiles = await readdir(agentDir);
      const agentFiles = allAgentFiles.filter((f) => f.endsWith(".jsonl"));
      for (const f of agentFiles) {
        const parsed = parseFilename(f, dir.name);
        if (parsed != null) files.push(parsed);
      }
    }

    for (const entry of flatFiles) {
      const parsed = parseFilename(entry.name, "unknown");
      if (parsed != null) files.push(parsed);
    }
  } catch {
    // Directory doesn't exist yet
  }

  return files.toSorted((a, b) => b.timestamp.localeCompare(a.timestamp));
}

async function readConversationFile(
  agent: string,
  filename: string,
): Promise<ConversationEntry[]> {
  const filePath =
    agent === "unknown"
      ? path.join(CONVERSATIONS_DIR, filename)
      : path.join(CONVERSATIONS_DIR, agent, filename);

  const content = await readFile(filePath, "utf8");
  const entries: ConversationEntry[] = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      entries.push(JSON.parse(trimmed) as ConversationEntry);
    } catch {
      // Skip malformed lines
    }
  }

  return entries;
}

export const conversationRouter = router({
  list: publicProcedure.query(async (): Promise<AgentGroup[]> => {
    const files = await getAllConversationFiles();
    const groups = new Map<string, ConversationFile[]>();

    for (const file of files) {
      const existing = groups.get(file.agent);
      if (existing == null) {
        groups.set(file.agent, [file]);
      } else {
        existing.push(file);
      }
    }

    return [...groups.entries()]
      .map(([agent, agentFiles]) => ({ agent, files: agentFiles }))
      .toSorted((a, b) => a.agent.localeCompare(b.agent));
  }),

  read: publicProcedure
    .input(
      z.object({
        filename: z.string().min(1),
        agent: z.string().default("unknown"),
      }),
    )
    .query(async ({ input }) => {
      if (input.filename.includes("..") || input.filename.includes("/")) {
        throw new Error("Invalid filename");
      }
      if (input.agent.includes("..") || input.agent.includes("/")) {
        throw new Error("Invalid agent");
      }
      return readConversationFile(input.agent, input.filename);
    }),

  bySession: publicProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .query(async ({ input }) => {
      const files = await getAllConversationFiles();
      const match = files.find((f) => f.sessionId === input.sessionId);
      if (match == null) return null;
      return {
        file: match,
        entries: await readConversationFile(match.agent, match.filename),
      };
    }),

  byJob: publicProcedure
    .input(z.object({ jobId: z.string().min(1) }))
    .query(async ({ input }) => {
      const files = await getAllConversationFiles();

      for (const file of files) {
        const filePath =
          file.agent === "unknown"
            ? path.join(CONVERSATIONS_DIR, file.filename)
            : path.join(CONVERSATIONS_DIR, file.agent, file.filename);

        try {
          const content = await readFile(filePath, "utf8");
          const firstLine = content.split("\n")[0]?.trim();
          if (firstLine == null || firstLine.length === 0) continue;

          const entry = JSON.parse(firstLine) as ConversationEntry;
          if (entry.jobId === input.jobId) {
            return {
              file,
              entries: await readConversationFile(file.agent, file.filename),
            };
          }
        } catch {
          continue;
        }
      }

      return null;
    }),
});
