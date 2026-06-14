export interface CreditCard {
  name: string;
  balance: number;
  interest_rate: number;
  minimumPayment: (creditCard: CreditCard) => number;
  limit: number;
  is_store_card: boolean;
}
