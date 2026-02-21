export type AmazonItem = {
  title: string;
  price: number;
  quantity: number;
  orderDate: string;
  orderId: string;
};

export type AmazonOrder = {
  orderId: string;
  date: string;
  total: number;
  items: AmazonItem[];
};

export type AmazonCache = {
  scrapedAt: string;
  orders: AmazonOrder[];
};
