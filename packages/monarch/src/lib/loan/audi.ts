import type { PdfLine } from "../pdf/extract.ts";
import type { LoanSplit } from "./types.ts";

// Audi Financial Services account statements.
//
// The statement states the split outright — "Payment Received 08/01/2025
// $1,516.36 / Principal $928.68 / Interest $587.68" — so nothing is derived.
// The difficulty is the rendering: these PDFs use Type3 fonts and extract one
// glyph at a time, so a line arrives as "Pa ym en t Re c e iv e d 0 8 /0 1 /2 0
// 2 5 $ 1, 5 1 6. 3 6". Whitespace therefore carries no meaning here and is
// removed before anything is matched, rather than being guessed at.

const ACCOUNT = /AccountNumber:(\d{6,})/;
const PAYMENT_RECEIVED =
  /PaymentReceived(\d{2})\/(\d{2})\/(\d{4})\$([\d,]+\.\d{2})/;
// Anchored: "2025YTDPrincipal" is a different figure on the same statement and
// would otherwise be read as this payment's.
const PRINCIPAL = /^Principal\$([\d,]+\.\d{2})$/;
const INTEREST = /^Interest\$([\d,]+\.\d{2})$/;
const CURRENT_BALANCE = /CurrentBalance\**\$([\d,]+\.\d{2})/;
const CENT = 0.005;

function money(raw: string): number {
  return Number.parseFloat(raw.replaceAll(",", ""));
}

function firstMatch(
  texts: string[],
  pattern: RegExp,
): RegExpExecArray | undefined {
  for (const text of texts) {
    const match = pattern.exec(text);
    if (match !== null) return match;
  }
  return undefined;
}

function firstAmount(texts: string[], pattern: RegExp): number | undefined {
  const match = firstMatch(texts, pattern);
  return match === undefined ? undefined : money(match[1] ?? "");
}

// One statement covers one payment. Returns undefined for a statement that
// records no payment — the first statement of a contract, before any is due.
export function parseAudiStatement(
  lines: PdfLine[],
  source: string,
): LoanSplit | undefined {
  const texts = lines.map((line) => line.text.replaceAll(/\s+/g, ""));

  const payment = firstMatch(texts, PAYMENT_RECEIVED);
  if (payment === undefined) return undefined;
  const date = `${payment[3] ?? ""}-${payment[1] ?? ""}-${payment[2] ?? ""}`;
  const amount = money(payment[4] ?? "");

  const principal = firstAmount(texts, PRINCIPAL);
  const interest = firstAmount(texts, INTEREST);

  // A statement that names a payment must name its split too. Accepting a
  // partial read would write a split that does not add up.
  if (principal === undefined || interest === undefined) {
    throw new Error(
      `${source}: payment of ${amount.toFixed(2)} on ${date} has no principal/interest breakdown`,
    );
  }
  if (Math.abs(principal + interest - amount) > CENT) {
    throw new Error(
      `${source}: principal ${principal.toFixed(2)} + interest ${interest.toFixed(2)} is not the ${amount.toFixed(2)} paid on ${date}`,
    );
  }

  return {
    loanId: firstMatch(texts, ACCOUNT)?.[1] ?? "Audi",
    date,
    amount,
    principal,
    interest,
    balanceAfter: firstAmount(texts, CURRENT_BALANCE) ?? 0,
    origin: "stated",
  };
}
