import { describe, expect, test } from "vitest";
import { parseLoanEmail } from "./parser.ts";

// The servicer's real wording, flattened the way the mail parser hands it over.
const REMINDER =
  "Hi Jerred, Your next payment is $1,254.90. Loan ID: IC7213772 " +
  "Payment scheduled: September 5, 2026 Payment due date: September 5, 2026 " +
  "Total outstanding principal: $17,830.97 Estimated months until fully " +
  "repaid*: 16 * Based on your currently scheduled payments.";

const CONFIRMATION =
  "Hi Jerred, Thank you for your payment on loan IC7213772. Your automatic " +
  "payment of $1,254.90 on September 5, 2026 has been processed from SoFi " +
  "savings: x-9151. You have 16 months left until your loan is fully paid off.";

const ONE_TIME =
  "Hi Jerred, Thank you for the payment on your loan IC7213772. We have " +
  "applied a payment of $15 on July 24, 2026 to your ICCU loan. Your SoFi " +
  "savings: x-9151 bank account has been debited.";

describe("parseLoanEmail", () => {
  test("reads the outstanding principal from a monthly reminder", () => {
    expect(parseLoanEmail(REMINDER, "2026-08-29").balances).toEqual([
      {
        loanId: "IC7213772",
        asOf: "2026-08-29",
        outstandingPrincipal: 17_830.97,
      },
    ]);
  });

  test("dates a balance by when it was sent, not the payment it forecasts", () => {
    // The reminder names a future scheduled date; the balance it states is
    // current as of the day it was sent, which is what the derivation needs.
    const parsed = parseLoanEmail(REMINDER, "2026-08-29");
    expect(parsed.balances?.[0]?.asOf).toBe("2026-08-29");
    expect(parsed.payments).toBeUndefined();
  });

  test("reads a scheduled payment confirmation", () => {
    expect(parseLoanEmail(CONFIRMATION, "2026-09-08").payments).toEqual([
      { loanId: "IC7213772", date: "2026-09-05", amount: 1254.9 },
    ]);
  });

  test("reads a one-time payment with no cents", () => {
    expect(parseLoanEmail(ONE_TIME, "2026-07-24").payments).toEqual([
      { loanId: "IC7213772", date: "2026-07-24", amount: 15 },
    ]);
  });

  test("takes the payment date from the message, not its delivery", () => {
    // The confirmation arrives days after the payment clears.
    expect(parseLoanEmail(CONFIRMATION, "2026-09-08").payments?.[0]?.date).toBe(
      "2026-09-05",
    );
  });

  test("ignores servicer mail that names no loan", () => {
    expect(
      parseLoanEmail("Jerred, curious about applying for a second loan?", "x"),
    ).toEqual({});
  });

  test("ignores marketing that quotes an example loan", () => {
    const marketing =
      "a borrower receives a loan of $10,000 for a term of 60 months, with " +
      "an interest rate of 18.60% and a 7.82% origination fee";
    expect(parseLoanEmail(marketing, "2026-08-25")).toEqual({});
  });
});
