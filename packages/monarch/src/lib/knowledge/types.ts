import type { Confidence } from "../classifier/types.ts";

export type CategoryDefinition = {
  id: string;
  name: string;
  group: string;
  description: string;
  examples: string[];
  notThisCategory: string[];
};

export type MerchantKnowledge = {
  merchantName: string;
  aliases: string[];
  merchantType: string;
  description: string;
  multiCategory: boolean;
  defaultCategory?: { id: string; name: string } | undefined;
  categoryHistory: { categoryName: string; count: number }[];
  source: "hint" | "web_search" | "learned" | "history";
  confidence: Confidence;
  lastUpdated: string;
};

export type EnrichmentSuggestion = {
  type:
    | "add_hint"
    | "add_deep_path_data"
    | "enable_integration"
    | "add_to_kb"
    | "resolve_conflict";
  merchantName: string;
  transactionCount: number;
  totalAmount: number;
  reason: string;
  suggestedAction: string;
  impact: "high" | "medium" | "low";
};
