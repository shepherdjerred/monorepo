import type { MonarchTransaction } from "../monarch/types.ts";

export type ConserviceCharge = {
  rowNumber: number;
  description: string;
  chargeAmount: number;
  paymentAmount: number;
  monthTotal: number;
  postMonth: string;
  transactionDate: string;
  chargeTypeId: number;
};

export type ConserviceMonthSummary = {
  month: string;
  total: number;
  rent: number;
  pets: number;
  waterSewer: number;
  electric: number;
  trash: number;
  charges: ConserviceCharge[];
};

export type BiltSplit = {
  category: string;
  amount: number;
};

export type BiltMatch = {
  monarchTransaction: MonarchTransaction;
  month: ConserviceMonthSummary;
  splits: BiltSplit[];
};
