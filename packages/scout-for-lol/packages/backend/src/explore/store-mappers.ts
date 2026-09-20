import { z } from "zod";
import {
  ExploreConversationSchema,
  ExploreMatchCardSchema,
  ExploreMessageSchema,
  ExploreTraceEntrySchema,
  ReportAiPreviewSummarySchema,
  VisualizationSnapshotSchema,
  type ExploreConversation,
  type ExploreMessage,
  type ExploreTranscript,
} from "@scout-for-lol/data";
import {
  deepestLeafFrom,
  pathToLeaf,
  siblingsOf,
  versionPosition,
} from "#src/explore/tree.ts";

const StringArraySchema = z.array(z.string());
const TraceArraySchema = z.array(ExploreTraceEntrySchema);
const MatchCardsSchema = z.array(ExploreMatchCardSchema).max(5);

export type ConversationRow = {
  id: string;
  title: string;
  origin: string;
  shareToken: string | null;
  sharedLeafId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type MessageRow = {
  id: string;
  parentId: string | null;
  role: string;
  content: string;
  spokenContent: string | null;
  queryText: string | null;
  caveats: string;
  followUps: string;
  preview: string | null;
  visualization: string | null;
  matchCards: string | null;
  guildIds: string | null;
  trace: string | null;
  createdAt: Date;
};

function parseJsonColumn<T>(
  raw: string | null,
  schema: z.ZodType<T>,
  column: string,
): T | null {
  if (raw === null) return null;
  const result = schema.safeParse(JSON.parse(raw));
  if (!result.success) {
    throw new Error(
      `Stored explore ${column} does not match its schema: ${result.error.message}`,
    );
  }
  return result.data;
}

export function toMessage(
  row: MessageRow,
  versions: { siblingIds: string[]; index: number; count: number },
): ExploreMessage {
  return ExploreMessageSchema.parse({
    id: row.id,
    role: row.role,
    parentId: row.parentId,
    siblingIds: versions.siblingIds,
    versionIndex: versions.index,
    versionCount: versions.count,
    content: row.content,
    queryText: row.queryText,
    caveats: parseJsonColumn(row.caveats, StringArraySchema, "caveats") ?? [],
    followUps:
      parseJsonColumn(row.followUps, StringArraySchema, "followUps") ?? [],
    preview: parseJsonColumn(
      row.preview,
      ReportAiPreviewSummarySchema,
      "preview",
    ),
    visualization: parseJsonColumn(
      row.visualization,
      VisualizationSnapshotSchema,
      "visualization",
    ),
    matchCards:
      parseJsonColumn(row.matchCards, MatchCardsSchema, "matchCards") ?? [],
    guildIds:
      parseJsonColumn(row.guildIds, StringArraySchema, "guildIds") ?? [],
    trace: parseJsonColumn(row.trace, TraceArraySchema, "trace") ?? [],
    createdAt: row.createdAt.toISOString(),
  });
}

export function toConversation(row: ConversationRow): ExploreConversation {
  return ExploreConversationSchema.parse({
    id: row.id,
    title: row.title,
    origin: row.origin,
    shareToken: row.shareToken,
    sharedLeafId: row.sharedLeafId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/** Position and sibling ids, derived together so they cannot disagree. */
export function versionsOf(
  nodes: { id: string; parentId: string | null; createdAt: Date }[],
  messageId: string,
): { siblingIds: string[]; index: number; count: number } {
  const position = versionPosition(nodes, messageId);
  return {
    siblingIds: siblingsOf(nodes, messageId).map((sibling) => sibling.id),
    index: position.index,
    count: position.count,
  };
}

/** Turn a loaded conversation tree into the transcript for one path. */
export function buildTranscript(
  conversation: ConversationRow,
  rows: MessageRow[],
  leafId: string | null,
): ExploreTranscript {
  const resolvedLeaf = leafId ?? deepestLeafFrom(rows, null);
  const path = pathToLeaf(rows, resolvedLeaf);
  return {
    conversation: toConversation(conversation),
    messages: path.map((row) => toMessage(row, versionsOf(rows, row.id))),
  };
}
