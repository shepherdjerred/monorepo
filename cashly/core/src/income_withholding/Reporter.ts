import { IncomeWithholding } from "./IncomeWithholding";

export class Reporter {
  sum(withholdings: IncomeWithholding): number {
    return withholdings.withholdings.reduce((prev, curr) => prev + curr.amount, 0);
  }
}
