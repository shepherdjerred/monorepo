export type AppleReceipt = {
  orderId: string;
  date: string;
  total: number;
  items: AppleReceiptItem[];
};

export type AppleReceiptItem = {
  title: string;
  price: number;
  isSubscription: boolean;
};
