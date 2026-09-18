import type { MonarchTransaction } from "../monarch/types.ts";

export type ConserviceCharge = {
  // Which bill this charge was printed on. The API reports a post month per
  // charge, so several post months belong to one monthly bill; a statement PDF
  // is one bill, identified by its due date. Two bills can fall in the same
  // calendar month — a regular bill and a move-out final statement — so the
  // bill, not the month, is what groups charges.
  billId: string;
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
  billId: string;
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
