import { z } from "zod";

export type MonarchCategory = {
  id: string;
  name: string;
  order: number;
  isSystemCategory: boolean;
  isDisabled: boolean;
  group: {
    id: string;
    name: string;
    type: string;
  };
};

export const MonarchMerchantSchema = z.object({
  id: z.string(),
  name: z.string(),
  transactionsCount: z.number(),
});

export type MonarchMerchant = z.infer<typeof MonarchMerchantSchema>;

export type MonarchAccount = {
  id: string;
  displayName: string;
};

export const MonarchTransactionSchema = z.object({
  id: z.string(),
  amount: z.number(),
  pending: z.boolean(),
  date: z.string(),
  hideFromReports: z.boolean(),
  plaidName: z.string(),
  notes: z.string().nullable().transform((v) => v ?? ""),
  isRecurring: z.boolean(),
  reviewStatus: z.string().nullable().transform((v) => v ?? ""),
  needsReview: z.boolean(),
  isSplitTransaction: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  category: z.object({ id: z.string(), name: z.string() }),
  merchant: MonarchMerchantSchema,
  account: z.object({ id: z.string(), displayName: z.string() }),
  tags: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      color: z.string(),
      order: z.number(),
    }),
  ),
});

export type MonarchTransaction = z.infer<typeof MonarchTransactionSchema>;

