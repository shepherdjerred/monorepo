// One RSU grant releasing shares on a vest date. Schwab's Equity Award Center
// export prints these as a parent row (date, action, quantity) followed by a
// detail row carrying the grant it came from.
export type VestAward = {
  awardDate: string;
  awardId: string;
  quantity: number;
  fairMarketValue: number;
  sharesWithheldForTaxes: number;
  netSharesDeposited: number;
  taxes: number;
};

// Every award releasing on one date. Monarch records one zero-amount row per
// award, and those rows are indistinguishable from each other, so the vest
// date — not the individual award — is the unit that can be matched.
export type VestEvent = {
  vestDate: string;
  symbol: string;
  awards: VestAward[];
};
