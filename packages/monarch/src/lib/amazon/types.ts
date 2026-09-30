export type AmazonItem = {
  title: string;
  price: number;
  quantity: number;
  orderDate: string;
  orderId: string;
};

// One card transaction from the order-details "Transactions" section.
// Negative amount = refund back to the card.
export type AmazonCharge = {
  date: string;
  amount: number;
  description: string;
};

export type AmazonOrder = {
  orderId: string;
  date: string;
  total: number;
  items: AmazonItem[];
  // Empty when the page lists no card transactions (e.g. gift-card-only).
  charges: AmazonCharge[];
};

export type AmazonCache = {
  version: 2;
  scrapedAt: string;
  orders: AmazonOrder[];
};
