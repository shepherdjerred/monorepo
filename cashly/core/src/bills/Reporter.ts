import { UtilityBill } from "./UtilityBill";

export class Reporter {
  averageCost(bill: UtilityBill): number {
    const total = bill.history.reduce((prev, next) => prev + next.amount, 0);
    return total / bill.history.length;
  }
}
