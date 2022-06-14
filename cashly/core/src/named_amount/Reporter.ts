import { NamedAmount } from "./NamedAmount";

export class Reporter {
  sum(amounts: NamedAmount[]): number {
    return amounts.reduce((previous, amount) => previous + amount.amount, 0);
  }
}
