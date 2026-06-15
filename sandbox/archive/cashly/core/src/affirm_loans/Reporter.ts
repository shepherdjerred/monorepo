import { AffirmLoan } from "./AffirmLoan";

export class Reporter {
  totalPayments(loan: AffirmLoan[]): number {
    return loan.reduce((prev, loan) => prev + loan.minimum_payment, 0);
  }
}
