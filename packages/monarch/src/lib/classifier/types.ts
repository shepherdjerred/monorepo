export type Confidence = "high" | "medium" | "low";

export type AmazonItemClassification = {
  title: string;
  price: number;
  categoryId: string;
  categoryName: string;
};

export type AmazonOrderInput = {
  orderIndex: number;
  items: { title: string; price: number }[];
};

export type AmazonBatchOrderClassification = {
  orderIndex: number;
  items: AmazonItemClassification[];
  needsSplit: boolean;
};

export type AmazonBatchResponse = {
  orders: AmazonBatchOrderClassification[];
};

export type VenmoPaymentClassification = {
  note: string;
  amount: number;
  categoryId: string;
  categoryName: string;
  confidence: Confidence;
};

export type VenmoClassificationResponse = {
  payments: VenmoPaymentClassification[];
};

export type TransactionClassification = {
  transactionIndex: number;
  categoryId: string;
  categoryName: string;
  confidence: Confidence;
};

export type CachedTransactionClassification = {
  transactionId: string;
  categoryId: string;
  categoryName: string;
  confidence: Confidence;
};

export type WeekClassificationResponse = {
  transactions: TransactionClassification[];
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
