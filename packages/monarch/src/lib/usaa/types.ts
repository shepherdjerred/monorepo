export type UsaaStatement = {
  statementDate: string;
  draftDate: string;
  totalAmount: number;
  autoAmount: number;
  rentersAmount: number;
};

export type UsaaMatch = {
  monarchTransactionId: string;
  monarchDate: string;
  monarchAmount: number;
  statement: UsaaStatement;
};
