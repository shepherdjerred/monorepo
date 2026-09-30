// One completed sale, as the broker's realized gain/loss export states it.
// The basis is the part no bank line can ever carry: $25,943.70 arriving in
// checking says nothing about whether the shares that produced it were sold
// at a gain or a loss.
export type ShareSale = {
  symbol: string;
  soldDate: string;
  quantity: number;
  price: number;
  proceeds: number;
  costBasis: number;
  gainLoss: number;
};

// Cash leaving the brokerage. This is the side Monarch actually records —
// the sale itself never reaches the bank.
export type CashEvent = {
  kind: "transfer" | "interest";
  date: string;
  amount: number;
  description: string;
};

// A cash event with the sale that funded it, when there is one. `cashSwept`
// is the difference between the two: a transfer empties the account, so it
// carries any idle cash sitting alongside the proceeds.
export type FundedEvent = {
  event: CashEvent;
  sale: ShareSale | undefined;
  cashSwept: number;
};
