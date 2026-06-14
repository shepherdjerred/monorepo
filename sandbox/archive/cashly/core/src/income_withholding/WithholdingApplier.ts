import { Income } from "../income/Income";
import { AbsoluteWithholding } from "../withholdings/AbsoluteWithholding";
import { RelativeWithholding } from "../withholdings/RelativeWithholding";
import { IncomeWithholding } from "./IncomeWithholding";

export class WithholdingApplier {
  apply(income: Income, withholdings: (AbsoluteWithholding | RelativeWithholding)[]): IncomeWithholding {
    const appliedWithholdings = withholdings.map((withholding) => {
      if (this.isAbsolute(withholding)) {
        return {
          withholding: withholding,
          amount: withholding.amount,
        };
      } else {
        return {
          withholding: withholding,
          amount: income.amount * withholding.percent,
        };
      }
    });
    return {
      income: income,
      withholdings: appliedWithholdings,
    };
  }

  applyAll(income: Income[], withholdings: (AbsoluteWithholding | RelativeWithholding)[]): IncomeWithholding[] {
    return income.map((incomeEntry) => this.apply(incomeEntry, withholdings));
  }

  isAbsolute(withholding: AbsoluteWithholding | RelativeWithholding): withholding is AbsoluteWithholding {
    return "amount" in withholding;
  }
}
