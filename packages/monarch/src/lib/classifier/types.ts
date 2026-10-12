export type Confidence = "high" | "medium" | "low";
export type ProposedChange = {
  transactionId: string;
  transactionDate: string;
  merchantName: string;
  amount: number;
  currentCategory: string;
  currentCategoryId: string;
  proposedCategory: string;
  proposedCategoryId: string;
  confidence: Confidence;
  type: "recategorize" | "split" | "flag";
  splits?: ProposedSplit[] | undefined;
  reason?: string | undefined;
  tier?: 1 | 2 | 3 | undefined;
  enrichmentSource?: string | undefined;
};

export type ProposedSplit = {
  itemName: string;
  amount: number;
  categoryId: string;
  categoryName: string;
  date?: string | undefined;
};
