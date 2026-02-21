declare module "monarch-money-api" {
  export function setToken(token: string): void;

  export function getTransactions(options: {
    limit?: number;
    offset?: number;
    startDate?: string | null;
    endDate?: string | null;
    search?: string;
    categoryIds?: string[];
    accountIds?: string[];
    tagIds?: string[];
    hasAttachments?: boolean | null;
    hasNotes?: boolean | null;
    hiddenFromReports?: boolean | null;
    isSplit?: boolean | null;
    isRecurring?: boolean | null;
    importedFromMint?: boolean | null;
    syncedFromInstitution?: boolean | null;
  }): Promise<{
    allTransactions: {
      totalCount: number;
      results: {
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
        merchant: {
          name: string;
          id: string;
          transactionsCount: number;
        };
        account: {
          id: string;
          displayName: string;
        };
        tags: {
          id: string;
          name: string;
          color: string;
          order: number;
        }[];
      }[];
    };
  }>;

  export function getTransactionCategories(): Promise<{
    categories: {
      id: string;
      order: number;
      name: string;
      systemCategory: string;
      isSystemCategory: boolean;
      isDisabled: boolean;
      updatedAt: string;
      createdAt: string;
      group: {
        id: string;
        name: string;
        type: string;
      };
    }[];
  }>;

  export function updateTransaction(options: {
    transactionId: string;
    categoryId?: string | null;
    merchantName?: string | null;
    goalId?: string | null;
    amount?: number | null;
    date?: string | null;
    hideFromReports?: boolean | null;
    needsReview?: boolean | null;
    notes?: string | null;
  }): Promise<{
    updateTransaction: {
      transaction: {
        id: string;
        amount: number;
        category: { id: string };
        merchant: { id: string; name: string };
        needsReview: boolean;
      };
      errors: {
        fieldErrors: { field: string; messages: string[] }[];
        message: string;
        code: string;
      }[];
    };
  }>;

  export function getTransactionSplits(transactionId: string): Promise<{
    getTransaction: {
      id: string;
      amount: number;
      category: { id: string; name: string };
      merchant: { id: string; name: string };
      splitTransactions: {
        id: string;
        merchant: { id: string; name: string };
        category: { id: string; name: string };
        amount: number;
        notes: string;
      }[];
    };
  }>;

  export function updateTransactionSplits(
    transactionId: string,
    splitData: {
      merchantName?: string;
      amount: number;
      categoryId: string;
      notes?: string;
    }[],
  ): Promise<{
    updateTransactionSplit: {
      transaction: {
        id: string;
        hasSplitTransactions: boolean;
        splitTransactions: {
          id: string;
          merchant: { id: string; name: string };
          category: { id: string; name: string };
          amount: number;
          notes: string;
        }[];
      };
      errors: {
        fieldErrors: { field: string; messages: string[] }[];
        message: string;
        code: string;
      }[];
    };
  }>;
}
