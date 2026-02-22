export type CostcoOrder = {
  orderId: string;
  date: string;
  total: number;
  items: CostcoItem[];
  source: "online" | "warehouse";
};

export type CostcoItem = {
  title: string;
  price: number;
  quantity: number;
};

export type CostcoCache = {
  scrapedAt: string;
  orders: CostcoOrder[];
};
