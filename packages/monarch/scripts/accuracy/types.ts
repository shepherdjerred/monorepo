export type DeepPath =
  | "amazon"
  | "venmo"
  | "bilt"
  | "usaa"
  | "scl"
  | "apple"
  | "costco"
  | "regular";

export type SampledTransaction = {
  id: string;
  date: string;
  amount: number;
  merchantName: string;
  plaidName: string;
  accountName: string;
  currentCategory: string;
  currentCategoryId: string;
  notes: string;
  isRecurring: boolean;
  deepPath: DeepPath;
};

export type GroundTruthLabel = {
  transactionId: string;
  correctCategory: string;
  correctCategoryId: string;
  shouldSplit: boolean;
  labelNotes?: string;
  labeledAt: string;
};

export type CategoryInfo = {
  id: string;
  name: string;
  group: string;
};

export type Dataset = {
  sampledAt: string;
  seed: number;
  transactions: SampledTransaction[];
  labels: GroundTruthLabel[];
  categories: CategoryInfo[];
};

export type ComparisonResult = {
  transactionId: string;
  merchantName: string;
  amount: number;
  date: string;
  deepPath: string;
  groundTruthCategory: string;
  toolCategory: string;
  toolConfidence: "high" | "medium" | "low" | "agreed";
  isCorrect: boolean;
  monarchWasCorrect: boolean;
};
