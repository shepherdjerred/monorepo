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

export type MonarchMerchant = {
  id: string;
  name: string;
  transactionsCount: number;
};

export type MonarchAccount = {
  id: string;
  displayName: string;
};

export type MonarchTransaction = {
  id: string;
  amount: number;
  pending: boolean;
  date: string;
  hideFromReports: boolean;
  plaidName: string;
  notes: string;
  isRecurring: boolean;
  reviewStatus: string;
  needsReview: boolean;
  isSplitTransaction: boolean;
  createdAt: string;
  updatedAt: string;
  category: {
    id: string;
    name: string;
  };
  merchant: MonarchMerchant;
  account: MonarchAccount;
  tags: {
    id: string;
    name: string;
    color: string;
    order: number;
  }[];
};

export type MerchantGroup = {
  merchantName: string;
  transactions: MonarchTransaction[];
  totalAmount: number;
  count: number;
  plaidNames: string[];
  currentCategory: string;
  currentCategoryId: string;
};
