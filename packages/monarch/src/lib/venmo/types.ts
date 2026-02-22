export type VenmoTransaction = {
  id: string;
  datetime: string;
  type: string;
  status: string;
  note: string;
  from: string;
  to: string;
  amount: number;
  tip: number;
  tax: number;
  fee: number;
};
