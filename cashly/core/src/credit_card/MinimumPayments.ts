import { CreditCard } from "./CreditCard";
import { calculateInterest } from "../debt/InterestCalculator";

export function constantPayment(constant: number): (card: CreditCard) => number {
  return (): number => {
    return constant;
  };
}

export function interestPayment(): (card: CreditCard) => number {
  return (card: CreditCard): number => {
    return calculateInterest(card);
  };
}

export function percentOfCurrentBalancePayment(percent: number): (card: CreditCard) => number {
  return (card: CreditCard): number => {
    return percent * card.balance;
  };
}

export function addPayments(...calculators: ((card: CreditCard) => number)[]): (card: CreditCard) => number {
  return (card: CreditCard): number => {
    return calculators.reduce((previous, calculator) => previous + calculator(card), 0);
  };
}

export function maxPayment(...calculators: ((card: CreditCard) => number)[]): (card: CreditCard) => number {
  return (card: CreditCard): number => {
    const amounts = calculators.map((calculator) => calculator(card));
    return Math.max(...amounts);
  };
}

export function interestPlusPercentOfCurrentBalanceOrFloorPayment(
  percent: number,
  floor: number
): (card: CreditCard) => number {
  return maxPayment(addPayments(percentOfCurrentBalancePayment(percent), interestPayment()), constantPayment(floor));
}
