import { Income } from "../income/Income";
import { AppliedWithholding } from "../withholdings/AppliedWithholding";

export interface IncomeWithholding {
  income: Income;
  withholdings: AppliedWithholding[];
}
