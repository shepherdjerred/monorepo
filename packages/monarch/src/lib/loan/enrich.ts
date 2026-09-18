import type { MonarchTransaction, MonarchCategory } from "../monarch/types.ts";
import type { TransactionEnrichment } from "../enrichment/types.ts";
import type { ProposedChange, ProposedSplit } from "../classifier/types.ts";
import { loadLoanMail } from "./parser.ts";
import { deriveLoanSchedule } from "./schedule.ts";
import { matchLoanPayments } from "./matcher.ts";
import type { LoanMatch } from "./matcher.ts";
import { log } from "../logger.ts";

export type LoanEnrichResult = {
  enrichments: Map<string, TransactionEnrichment>;
  matchRate: { matched: number; total: number };
  changes: ProposedChange[];
};

// A loan payment retires principal and buys the use of the money for a month.
// Recording the whole amount as repayment overstates what was repaid and hides
// the cost of the debt entirely, so each payment becomes two legs.
const PRINCIPAL_CATEGORY = "Loan Repayment";
const INTEREST_CATEGORY = "Loan Interest";

function buildSplitChange(
  match: LoanMatch,
  principalId: string,
  interestId: string,
): ProposedChange {
  const { transaction, split } = match;
  // Legs are positive magnitudes summing to the payment: `verify.ts` compares
  // their raw sum against the absolute amount, and `apply.ts` puts the
  // parent's sign back on. Negative legs here would be silently demoted to a
  // review flag instead of splitting.
  //
  // No `date` on a leg: the field is forwarded raw into the GraphQL variables
  // and is not part of the mutation's split input.
  const splits: ProposedSplit[] = [
    {
      itemName: "Principal",
      amount: split.principal,
      categoryId: principalId,
      categoryName: PRINCIPAL_CATEGORY,
    },
    {
      itemName: "Interest",
      amount: split.interest,
      categoryId: interestId,
      categoryName: INTEREST_CATEGORY,
    },
  ];

  return {
    transactionId: transaction.id,
    transactionDate: transaction.date,
    merchantName: transaction.merchant.name,
    amount: transaction.amount,
    currentCategory: transaction.category.name,
    currentCategoryId: transaction.category.id,
    // The established convention for a split: the top-level category is not
    // read on the apply path.
    proposedCategory: "SPLIT",
    proposedCategoryId: "",
    confidence: "high",
    type: "split",
    splits,
    reason: `Loan ${split.loanId}: the servicer's balance fell ${split.principal.toFixed(2)} against a ${split.amount.toFixed(2)} payment, so the remaining ${split.interest.toFixed(2)} is interest`,
    enrichmentSource: "loan",
  };
}

export async function enrichLoan(
  loanTransactions: MonarchTransaction[],
  categories: MonarchCategory[],
): Promise<LoanEnrichResult> {
  const empty = {
    enrichments: new Map<string, TransactionEnrichment>(),
    matchRate: { matched: 0, total: loanTransactions.length },
    changes: [],
  };

  const principal = categories.find((c) => c.name === PRINCIPAL_CATEGORY);
  const interest = categories.find((c) => c.name === INTEREST_CATEGORY);
  if (principal === undefined || interest === undefined) {
    // Splitting into a category that does not exist would fail per
    // transaction at the API. Say so once instead.
    log.warn(
      `Loan splits need both a "${PRINCIPAL_CATEGORY}" and a "${INTEREST_CATEGORY}" category; create the missing one in Monarch`,
    );
    return empty;
  }

  const { balances, payments } = await loadLoanMail();
  const { splits, gaps } = deriveLoanSchedule(balances, payments);
  log.info(
    `Derived ${String(splits.length)} principal/interest splits from the servicer's statements`,
  );
  for (const gap of gaps) {
    log.warn(`  ${gap.loanId} ${gap.from}..${gap.to}: ${gap.reason}`);
  }

  const result = matchLoanPayments(loanTransactions, splits);
  log.info(
    `Matched ${String(result.matched.length)}/${String(loanTransactions.length)} loan payments to a derived split`,
  );
  if (result.unmatched.length > 0) {
    const value = result.unmatched.reduce(
      (sum, t) => sum + Math.abs(t.amount),
      0,
    );
    log.info(
      `${String(result.unmatched.length)} payments ($${value.toFixed(2)}) have no derivable split and are left alone`,
    );
  }

  const enrichments = new Map<string, TransactionEnrichment>();
  const changes: ProposedChange[] = [];
  for (const match of result.matched) {
    enrichments.set(match.transaction.id, {
      loan: {
        loanId: match.split.loanId,
        principal: match.split.principal,
        interest: match.split.interest,
        balanceAfter: match.split.balanceAfter,
      },
      enrichmentSource: "loan",
    });
    changes.push(buildSplitChange(match, principal.id, interest.id));
  }

  return {
    enrichments,
    matchRate: {
      matched: result.matched.length,
      total: loanTransactions.length,
    },
    changes,
  };
}
