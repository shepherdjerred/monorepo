// A servicer's statement of how much principal is still owed on one loan, as
// of the day it was sent.
export type LoanBalance = {
  loanId: string;
  asOf: string;
  outstandingPrincipal: number;
};

// A payment the servicer confirmed, named to its loan. Several loans can be
// open at once and the bank records them all under one merchant, so the loan
// this belongs to is the only thing that makes a balance series interpretable.
export type LoanPayment = {
  loanId: string;
  date: string;
  amount: number;
};

// One payment split the way the loan actually applied it.
export type LoanSplit = {
  loanId: string;
  date: string;
  amount: number;
  principal: number;
  interest: number;
  // What was still owed after this payment, for the note.
  balanceAfter: number;
};

// A payment that could not be split, and why. Reported rather than guessed at.
export type LoanGap = {
  loanId: string;
  from: string;
  to: string;
  reason: string;
};
