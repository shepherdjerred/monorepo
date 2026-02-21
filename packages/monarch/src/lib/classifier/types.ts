export type Confidence = "high" | "medium" | "low";

export type MerchantClassification = {
  merchantName: string;
  categoryId: string;
  categoryName: string;
  confidence: Confidence;
  ambiguous: boolean;
  reason?: string | undefined;
};

export type MerchantBatchResponse = {
  merchants: MerchantClassification[];
};

export type AmazonItemClassification = {
  title: string;
  price: number;
  categoryId: string;
  categoryName: string;
};

export type AmazonClassificationResponse = {
  items: AmazonItemClassification[];
  needsSplit: boolean;
};

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
};

export type ProposedSplit = {
  itemName: string;
  amount: number;
  categoryId: string;
  categoryName: string;
};
