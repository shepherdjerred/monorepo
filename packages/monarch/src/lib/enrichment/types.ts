import type { MonarchTransaction } from "../monarch/types.ts";

export type TransactionEnrichment = {
  // Amazon/Costco: what items were in this order
  items?: { title: string; price: number }[];

  // Venmo: payment context
  paymentNote?: string;
  paymentDirection?: "sent" | "received";
  paymentCounterparty?: string;

  // Bilt/Conservice: bill breakdown
  billBreakdown?: { serviceType: string; amount: number }[];

  // Apple: receipt items with subscription flags
  receiptItems?: { title: string; price: number; isSubscription: boolean }[];

  // USAA: insurance line items
  insuranceLines?: { policyType: string; amount: number }[];

  // SCL: billing period info
  billingPeriods?: { period: string; amount: number }[];

  // Web search / merchant research
  merchantDescription?: string;
  merchantType?: string;

  // Source tracking
  enrichmentSource: string;
};

export type Tier = 1 | 2 | 3;

export type EnrichedTransaction = {
  transaction: MonarchTransaction;
  enrichment: TransactionEnrichment | undefined;
  tier: Tier;
  deepPath:
    | "amazon"
    | "venmo"
    | "bilt"
    | "usaa"
    | "scl"
    | "apple"
    | "costco"
    | "regular";
};
