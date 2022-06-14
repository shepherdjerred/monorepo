import { Debt } from "./Debt";
import { calculateInterest } from "./InterestCalculator";

export class Reporter {
  totalInterest(debts: Debt[]): number {
    return debts.reduce((prev, debt) => prev + calculateInterest(debt), 0);
  }
}
