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

  // Paystub: payroll period breakdown (notes + verification only; payroll
  // is never split because only net pay reaches the account)
  payslip?: {
    periodStart: string;
    periodEnd: string;
    grossPay: number;
    netPay: number;
    employeeTaxes: number;
    preTaxDeductions: number;
    earnings: { label: string; amount: number }[];
    taxes: { label: string; amount: number }[];
    deductions: { label: string; amount: number }[];
    grossChangePercent?: number | undefined;
  };

  // Equity: RSU vest, aggregated over every award releasing that day. Monarch
  // books one zero-amount row per award and they are indistinguishable, so
  // each row of a vest date carries the same event summary.
  vest?: {
    vestDate: string;
    symbol: string;
    awardCount: number;
    shares: number;
    fairMarketValue: number;
    grossValue: number;
    sharesWithheld: number;
    netShares: number;
    taxes: number;
  };

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
    | "paystub"
    | "equity"
    | "regular";
};
