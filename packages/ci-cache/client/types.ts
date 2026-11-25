import { z } from "zod";

export const SummaryEntrySchema = z.object({
  namespace: z.string(),
  protocol: z.string(),
  key: z.string(),
  sizeBytes: z.number().nonnegative(),
  sha256Hex: z.string(),
  hasSignatureTag: z.boolean(),
  durationMs: z.number().nonnegative().nullable(),
  createdAt: z.number(),
  lastAccessedAt: z.number(),
  hitCount: z.number().nonnegative(),
});

export type SummaryEntry = z.infer<typeof SummaryEntrySchema>;

export const SummaryNamespaceSchema = z.object({
  namespace: z.string(),
  protocol: z.string(),
  entries: z.number().nonnegative(),
  storedBytes: z.number().nonnegative(),
  ttlSeconds: z.number().nonnegative(),
  hits24h: z.number().nonnegative(),
  misses24h: z.number().nonnegative(),
  hitRate24h: z.number().nonnegative(),
  bytesServed24h: z.number().nonnegative(),
  evictions24h: z.number().nonnegative(),
  lastAccessedAt: z.number().nullable(),
});

export type SummaryNamespace = z.infer<typeof SummaryNamespaceSchema>;

export const SummaryWindow24hSchema = z.object({
  hits: z.number().nonnegative(),
  misses: z.number().nonnegative(),
  hitRate: z.number().nonnegative(),
  bytesServed: z.number().nonnegative(),
  bytesIngested: z.number().nonnegative(),
  puts: z.number().nonnegative(),
  evictions: z.number().nonnegative(),
});

export type SummaryWindow24h = z.infer<typeof SummaryWindow24hSchema>;

export const SummaryResponseSchema = z.object({
  generatedAt: z.number(),
  quotaBytes: z.number().nonnegative(),
  highWatermarkBytes: z.number().nonnegative(),
  lowWatermarkBytes: z.number().nonnegative(),
  totalStoredBytes: z.number().nonnegative(),
  totalEntries: z.number().nonnegative(),
  window24h: SummaryWindow24hSchema,
  namespaces: z.array(SummaryNamespaceSchema),
  largestEntries: z.array(SummaryEntrySchema),
  recentEntries: z.array(SummaryEntrySchema),
});

export type SummaryResponse = z.infer<typeof SummaryResponseSchema>;

export type NamespaceFilter =
  | "overview"
  | "turbo-main"
  | "turbo-pr"
  | "gradle"
  | "sccache-main"
  | "sccache-pr";

export type NamespaceCounts = Readonly<Record<NamespaceFilter, number>>;

export type EntryViewTab = "largest" | "recent";
