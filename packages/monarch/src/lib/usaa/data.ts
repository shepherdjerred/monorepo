import type { UsaaStatement } from "./types.ts";

// Extracted from USAA PDF statements in ~/Downloads/usaa/
// Draft dates are the 7th of the month following the statement date.
// Auto = "WA Auto 7101" Min Due Now, Renters = "WA Renters Insurance 001" Min Due Now.
// For statements with Past Due Premium / Late Fee, those amounts are included
// in totalAmount but not in auto/renters — the remainder is allocated proportionally.
export const USAA_STATEMENTS: UsaaStatement[] = [
  { statementDate: "2024-12-11", draftDate: "2025-01-07", totalAmount: 147.92, autoAmount: 106.78, rentersAmount: 41.14 },
  { statementDate: "2025-01-11", draftDate: "2025-02-07", totalAmount: 217.04, autoAmount: 159.9, rentersAmount: 57.14 },
  { statementDate: "2025-02-08", draftDate: "2025-03-07", totalAmount: 449.08, autoAmount: 159.9, rentersAmount: 57.14 },
  { statementDate: "2025-03-11", draftDate: "2025-04-07", totalAmount: 257.15, autoAmount: 198.6, rentersAmount: 58.55 },
  { statementDate: "2025-04-10", draftDate: "2025-05-07", totalAmount: 257.15, autoAmount: 198.6, rentersAmount: 58.55 },
  { statementDate: "2025-05-11", draftDate: "2025-06-07", totalAmount: 529.3, autoAmount: 198.6, rentersAmount: 58.55 },
  { statementDate: "2025-06-10", draftDate: "2025-07-07", totalAmount: 257.16, autoAmount: 198.56, rentersAmount: 58.6 },
  { statementDate: "2025-08-11", draftDate: "2025-09-07", totalAmount: 261.9, autoAmount: 190.58, rentersAmount: 71.32 },
  { statementDate: "2025-09-10", draftDate: "2025-10-07", totalAmount: 261.9, autoAmount: 190.58, rentersAmount: 71.32 },
  { statementDate: "2025-10-11", draftDate: "2025-11-07", totalAmount: 261.9, autoAmount: 190.58, rentersAmount: 71.32 },
  { statementDate: "2025-11-10", draftDate: "2025-12-07", totalAmount: 261.9, autoAmount: 190.58, rentersAmount: 71.32 },
  { statementDate: "2025-12-11", draftDate: "2026-01-07", totalAmount: 169.11, autoAmount: 123.06, rentersAmount: 46.05 },
  { statementDate: "2026-01-11", draftDate: "2026-02-07", totalAmount: 328.98, autoAmount: 257.66, rentersAmount: 71.32 },
  { statementDate: "2026-02-08", draftDate: "2026-03-07", totalAmount: 328.98, autoAmount: 257.66, rentersAmount: 71.32 },
];
