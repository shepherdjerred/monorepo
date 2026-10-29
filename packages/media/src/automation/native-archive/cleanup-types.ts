import type { z } from "zod";
import type { ContentProof } from "#filesystem/content-proof.ts";
import type { JournalProof } from "#automation/handoff/journals.ts";
import type {
  NativeArchiveExecutionSchema,
  NativeArchiveContinuation,
  NativeArchiveScope,
} from "#shared/native-recovery/archive.ts";

export type ArchiveExecution = z.infer<typeof NativeArchiveExecutionSchema>;
export type ArchiveParticipant = ArchiveExecution["participants"][number];
export type ArchiveContentFacts = Pick<
  ContentProof,
  "digest" | "reviewIdentity" | "reviewAbsence"
>;
export type ArchiveCleanupFacts = {
  content: ArchiveContentFacts;
  paths: string[];
  execution: ArchiveExecution;
  executionCommitted: boolean;
  descriptor: NativeArchiveContinuation;
  scope: NativeArchiveScope;
};
export type ArchiveCleanupBase = Omit<ArchiveCleanupFacts, "content"> & {
  content: ContentProof;
};
export type ArchiveJournalEntries = Map<
  string,
  {
    device: string;
    inode: string;
    mtime: string;
    ctime: string;
    size: string;
  }
>;
export type ArchiveJournalProof = {
  kind: "movies" | "tv";
  journal: JournalProof;
  entries: ArchiveJournalEntries;
  ancestors: { path: string; device: string; inode: string }[];
};
export type ArchiveCleanupProof = ArchiveCleanupBase & {
  journals: ArchiveJournalProof[];
};
export type ArchiveCleanupMeasuredFacts = ArchiveCleanupFacts & {
  journals: ArchiveJournalProof[];
};
