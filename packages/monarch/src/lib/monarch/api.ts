import { z } from "zod";
import { MonarchTransactionSchema } from "./types.ts";
import { gqlRequest } from "./graphql.ts";

const PayloadErrorSchema = z.object({
  fieldErrors: z.array(
    z.object({
      field: z.string(),
      messages: z.array(z.string()),
    }),
  ),
  message: z.string(),
  code: z.string(),
});

const CategorySchema = z.object({
  id: z.string(),
  order: z.number(),
  name: z.string(),
  systemCategory: z.string().nullable(),
  isSystemCategory: z.boolean(),
  isDisabled: z.boolean(),
  updatedAt: z.string(),
  createdAt: z.string(),
  group: z.object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
  }),
});

const CategoriesResponseSchema = z.object({
  categories: z.array(CategorySchema),
});

const TransactionsResponseSchema = z.object({
  allTransactions: z.object({
    totalCount: z.number(),
    results: z.array(MonarchTransactionSchema),
  }),
});

const UpdateTransactionResponseSchema = z.object({
  updateTransaction: z.object({
    transaction: z.object({
      id: z.string(),
      amount: z.number(),
      category: z.object({ id: z.string() }),
      merchant: z.object({ id: z.string(), name: z.string() }),
      needsReview: z.boolean(),
    }),
    errors: z.array(PayloadErrorSchema).nullable(),
  }),
});

const TransactionSplitTxnSchema = z.object({
  id: z.string(),
  merchant: z.object({ id: z.string(), name: z.string() }),
  category: z.object({ id: z.string(), name: z.string() }),
  amount: z.number(),
  notes: z
    .string()
    .nullable()
    .transform((v) => v ?? ""),
});

const TransactionSplitsResponseSchema = z.object({
  getTransaction: z.object({
    id: z.string(),
    amount: z.number(),
    category: z.object({ id: z.string(), name: z.string() }),
    merchant: z.object({ id: z.string(), name: z.string() }),
    splitTransactions: z.array(TransactionSplitTxnSchema),
  }),
});

const UpdateTransactionSplitResponseSchema = z.object({
  updateTransactionSplit: z.object({
    transaction: z.object({
      id: z.string(),
      hasSplitTransactions: z.boolean(),
      splitTransactions: z.array(
        z.object({
          id: z.string(),
        }),
      ),
    }),
    errors: z.array(PayloadErrorSchema).nullable(),
  }),
});

export type TransactionsResponse = z.infer<typeof TransactionsResponseSchema>;
export type CategoriesResponse = z.infer<typeof CategoriesResponseSchema>;
export type UpdateTransactionResponse = z.infer<
  typeof UpdateTransactionResponseSchema
>;
export type TransactionSplitsResponse = z.infer<
  typeof TransactionSplitsResponseSchema
>;
export type UpdateTransactionSplitResponse = z.infer<
  typeof UpdateTransactionSplitResponseSchema
>;

export type GetTransactionsOptions = {
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
};

export async function getTransactions(
  options: GetTransactionsOptions = {},
): Promise<TransactionsResponse> {
  const { limit = 100, offset = 0 } = options;

  return gqlRequest(
    "Web_GetTransactionsList",
    GET_TRANSACTIONS_QUERY,
    {
      offset,
      limit,
      orderBy: "date",
      filters: buildTransactionFilters(options),
    },
    TransactionsResponseSchema,
  );
}

function buildTransactionFilters({
  startDate = null,
  endDate = null,
  search = "",
  categoryIds = [],
  accountIds = [],
  tagIds = [],
  hasAttachments = null,
  hasNotes = null,
  hiddenFromReports = null,
  isSplit = null,
  isRecurring = null,
  importedFromMint = null,
  syncedFromInstitution = null,
}: GetTransactionsOptions): Record<string, unknown> {
  const filters: Record<string, unknown> = {
    search,
    categories: categoryIds,
    accounts: accountIds,
    tags: tagIds,
  };

  addOptionalFilter(filters, "hasAttachments", hasAttachments);
  addOptionalFilter(filters, "hasNotes", hasNotes);
  addOptionalFilter(filters, "hideFromReports", hiddenFromReports);
  addOptionalFilter(filters, "isSplit", isSplit);
  addOptionalFilter(filters, "isRecurring", isRecurring);
  addOptionalFilter(filters, "importedFromMint", importedFromMint);
  addOptionalFilter(filters, "syncedFromInstitution", syncedFromInstitution);
  addDateFilters(filters, startDate, endDate);

  return filters;
}

function addOptionalFilter(
  filters: Record<string, unknown>,
  key: string,
  value: boolean | null,
): void {
  if (value !== null) filters[key] = value;
}

function addDateFilters(
  filters: Record<string, unknown>,
  startDate: string | null,
  endDate: string | null,
): void {
  if (startDate !== null && endDate !== null) {
    filters["startDate"] = startDate;
    filters["endDate"] = endDate;
    return;
  }
  if (startDate !== null || endDate !== null) {
    throw new Error(
      "You must specify both a startDate and endDate, not just one of them.",
    );
  }
}

export async function getCategories(): Promise<CategoriesResponse> {
  return gqlRequest(
    "GetCategories",
    GET_CATEGORIES_QUERY,
    {},
    CategoriesResponseSchema,
  );
}

export type UpdateTransactionOptions = {
  transactionId: string;
  categoryId?: string | null;
  merchantName?: string | null;
  goalId?: string | null;
  amount?: number | null;
  date?: string | null;
  hideFromReports?: boolean | null;
  needsReview?: boolean | null;
  notes?: string | null;
};

export async function updateTransaction(
  options: UpdateTransactionOptions,
): Promise<UpdateTransactionResponse> {
  return gqlRequest(
    "Web_TransactionDrawerUpdateTransaction",
    UPDATE_TRANSACTION_MUTATION,
    { input: buildUpdateTransactionInput(options) },
    UpdateTransactionResponseSchema,
  );
}

function buildUpdateTransactionInput({
  transactionId,
  categoryId = null,
  merchantName = null,
  goalId = null,
  amount = null,
  date = null,
  hideFromReports = null,
  needsReview = null,
  notes = null,
}: UpdateTransactionOptions): Record<string, unknown> {
  const input: Record<string, unknown> = { id: transactionId };
  addOptionalInput(input, "category", categoryId);
  addOptionalInput(input, "name", merchantName);
  addOptionalInput(input, "amount", amount);
  addOptionalInput(input, "date", date);
  addOptionalInput(input, "hideFromReports", hideFromReports);
  addOptionalInput(input, "needsReview", needsReview);
  addOptionalInput(input, "goalId", goalId);
  addOptionalInput(input, "notes", notes);
  return input;
}

function addOptionalInput(
  input: Record<string, unknown>,
  key: string,
  value: boolean | number | string | null,
): void {
  if (value !== null) input[key] = value;
}

export type SplitInput = {
  merchantName?: string;
  amount: number;
  categoryId: string;
  notes?: string;
};

export async function updateTransactionSplits(
  transactionId: string,
  splitData: SplitInput[],
): Promise<UpdateTransactionSplitResponse> {
  return gqlRequest(
    "Common_SplitTransactionMutation",
    UPDATE_TRANSACTION_SPLIT_MUTATION,
    { input: { transactionId, splitData } },
    UpdateTransactionSplitResponseSchema,
  );
}

export async function getTransactionSplits(
  transactionId: string,
): Promise<TransactionSplitsResponse> {
  return gqlRequest(
    "TransactionSplitQuery",
    TRANSACTION_SPLITS_QUERY,
    { id: transactionId },
    TransactionSplitsResponseSchema,
  );
}

const GET_TRANSACTIONS_QUERY = `
  query Web_GetTransactionsList($offset: Int, $limit: Int, $filters: TransactionFilterInput, $orderBy: TransactionOrdering) {
    allTransactions(filters: $filters) {
      totalCount
      results(offset: $offset, limit: $limit, orderBy: $orderBy) {
        id
        amount
        pending
        date
        hideFromReports
        plaidName
        notes
        isRecurring
        reviewStatus
        needsReview
        isSplitTransaction
        createdAt
        updatedAt
        category {
          id
          name
        }
        merchant {
          name
          id
          transactionsCount
        }
        tags {
          id
          name
          color
          order
        }
        account {
          id
          displayName
        }
      }
    }
  }
`;

const GET_CATEGORIES_QUERY = `
  query GetCategories {
    categories {
      id
      order
      name
      systemCategory
      isSystemCategory
      isDisabled
      updatedAt
      createdAt
      group {
        id
        name
        type
      }
    }
  }
`;

const UPDATE_TRANSACTION_MUTATION = `
  mutation Web_TransactionDrawerUpdateTransaction($input: UpdateTransactionMutationInput!) {
    updateTransaction(input: $input) {
      transaction {
        id
        amount
        needsReview
        category {
          id
        }
        merchant {
          id
          name
        }
      }
      errors {
        fieldErrors {
          field
          messages
        }
        message
        code
      }
    }
  }
`;

const TRANSACTION_SPLITS_QUERY = `
  query TransactionSplitQuery($id: UUID!) {
    getTransaction(id: $id) {
      id
      amount
      category {
        id
        name
      }
      merchant {
        id
        name
      }
      splitTransactions {
        id
        merchant {
          id
          name
        }
        category {
          id
          name
        }
        amount
        notes
      }
    }
  }
`;

const UPDATE_TRANSACTION_SPLIT_MUTATION = `
  mutation Common_SplitTransactionMutation($input: UpdateTransactionSplitMutationInput!) {
    updateTransactionSplit(input: $input) {
      errors {
        fieldErrors {
          field
          messages
        }
        message
        code
      }
      transaction {
        id
        hasSplitTransactions
        splitTransactions {
          id
        }
      }
    }
  }
`;
