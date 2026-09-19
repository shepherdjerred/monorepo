// Only the fields needed to note and verify a paycheck. Name, address,
// employee id, and bank account number are deliberately absent: they are not
// parsed, not cached, and never reach a prompt.
export type PayslipLine = {
  label: string;
  amount: number;
};

export type Payslip = {
  payDate: string;
  periodStart: string;
  periodEnd: string;
  hours: number;
  grossPay: number;
  preTaxDeductions: number;
  employeeTaxes: number;
  postTaxDeductions: number;
  netPay: number;
  earnings: PayslipLine[];
  taxes: PayslipLine[];
  deductions: PayslipLine[];
  // Page within the source bundle, for error messages only.
  sourcePage: number;
};

export type PayslipCache = {
  version: 1;
  builtAt: string;
  payslips: Payslip[];
};
