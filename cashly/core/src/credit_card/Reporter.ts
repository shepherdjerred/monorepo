import { CreditCard } from "./CreditCard";

export class Reporter {
  totalMinimumPayments(cards: CreditCard[]): number {
    return cards.reduce((prev, card) => prev + card.minimumPayment(card), 0);
  }

  remainingCredit(cards: CreditCard[]): number {
    return cards.map((card) => card.limit - card.balance).reduce((prev, card) => prev + card);
  }

  remainingNonStoreCredit(cards: CreditCard[]): number {
    return this.remainingCredit(cards.filter((card) => !card.is_store_card));
  }
}
