import { Debt } from "./Debt";

export function calculateInterest(debt: Debt): number {
  return (debt.interest_rate / 12) * debt.balance;
}
