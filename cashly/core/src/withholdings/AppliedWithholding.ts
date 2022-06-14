import { RelativeWithholding } from "./RelativeWithholding";
import { AbsoluteWithholding } from "./AbsoluteWithholding";

export interface AppliedWithholding {
  withholding: RelativeWithholding | AbsoluteWithholding;
  amount: number;
}
