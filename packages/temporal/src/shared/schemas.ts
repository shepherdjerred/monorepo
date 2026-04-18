import { z } from "zod/v4";

export const FetcherInputSchema = z.object({});

export const DepsSummaryInputSchema = z.object({
  daysBack: z.number().int().positive().default(7),
});

export const DnsAuditInputSchema = z.object({});

export const GolinkSyncInputSchema = z.object({});

export const VacuumInputSchema = z.object({});

export type FetcherInput = z.infer<typeof FetcherInputSchema>;
export type DepsSummaryInput = z.infer<typeof DepsSummaryInputSchema>;
export type DnsAuditInput = z.infer<typeof DnsAuditInputSchema>;
export type GolinkSyncInput = z.infer<typeof GolinkSyncInputSchema>;
export type VacuumInput = z.infer<typeof VacuumInputSchema>;
