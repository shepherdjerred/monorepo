import { describe, expect, test } from "vitest";
import { parseAppleDate, parseAppleReceipt } from "./parser.ts";

// Apple has shipped three receipt layouts. Each is represented here as the
// text the mail parser actually hands over, so a fourth layout arriving with
// no date or no total fails a test rather than silently matching nothing.

// The original: every field labelled with a colon, one item per line.
const LABELLED = `Apple Receipt

APPLE ACCOUNT
apple@example.com

ORDER ID:              MSSTXJ2GLT
DOCUMENT NO.:        139849103930
DATE:                Sep 10, 2024
TOTAL:                      $2.99

iCloud+
iCloud+ with 200 GB of Storage                     $2.99
Monthly
Renews Oct 10, 2024
`;

// The HTML store receipt: colons gone, whole body on one line.
const FLAT_STORE =
  "Receipt APPLE ACCOUNT apple@example.com BILLED TO Apple Card " +
  "Jerred Shepherd 345 N 137th St Seattle, WA 98133 USA DATE Aug 11, 2026 " +
  "ORDER ID MSSX19Z3SM DOCUMENT NO. 746174418884 App Store Telegram Messenger " +
  "750 Telegram Stars In-App Purchase jerred-iphone Report a Problem $14.99 " +
  "Subtotal $14.99 Tax $1.58 TOTAL $16.57 Get help with subscriptions. " +
  "Apple Account • Terms of Sale • Privacy Policy";

// The subscription renewal: no total row at all, and the date is printed as
// part of the word "Receipt".
const FLAT_RENEWAL =
  "Receipt August 30, 2026 Order ID: MSSX2LX696 Document: 800183420200 " +
  "Apple Account: apple@example.com HelloChinese - Learn Chinese " +
  "HelloChinese Premium (Monthly) Renews September 20, 2026 $11.99 " +
  "Billing and Payment Jerred Shepherd 345 N 137th St Seattle WA 98133 " +
  "United States Subtotal $11.99 Tax $1.26 Apple Card $13.25 " +
  "Apple Account • Terms of Sale";

// No subtotal: the item is followed straight by the total, and "Apple Account"
// appears again in the footer.
const FLAT_NO_SUBTOTAL =
  "Receipt APPLE ACCOUNT apple@example.com BILLED TO Apple Card " +
  "DATE Nov 10, 2024 ORDER ID MSSV2F6H5J DOCUMENT NO. 133873156928 " +
  "iCloud+ iCloud+ with 200 GB of Storage Monthly Renews Dec 10, 2024 $2.99 " +
  "TOTAL $2.99 If you have any questions about your bill, contact support. " +
  "Apple Account • Purchase History • Terms of Sale";

describe("parseAppleDate", () => {
  test("reads an abbreviated month", () => {
    expect(parseAppleDate("Sep 10, 2024")).toBe("2024-09-10");
  });

  test("reads a month spelled out", () => {
    expect(parseAppleDate("August 30, 2026")).toBe("2026-08-30");
  });

  test("reads a four-letter abbreviation", () => {
    expect(parseAppleDate("Sept 3, 2026")).toBe("2026-09-03");
  });

  test("returns empty for text with no date, so callers fail closed", () => {
    expect(parseAppleDate("Renews soon")).toBe("");
  });
});

describe("parseAppleReceipt", () => {
  test("reads the original labelled layout", () => {
    const receipt = parseAppleReceipt(LABELLED);
    expect(receipt?.orderId).toBe("MSSTXJ2GLT");
    expect(receipt?.date).toBe("2024-09-10");
    expect(receipt?.total).toBe(2.99);
    expect(receipt?.items).toEqual([
      {
        title: "iCloud+ with 200 GB of Storage",
        price: 2.99,
        isSubscription: true,
      },
    ]);
  });

  test("reads the flat store layout whose labels lost their colons", () => {
    const receipt = parseAppleReceipt(FLAT_STORE);
    expect(receipt?.orderId).toBe("MSSX19Z3SM");
    expect(receipt?.date).toBe("2026-08-11");
    // The charge is the total, not the $14.99 subtotal.
    expect(receipt?.total).toBe(16.57);
    expect(receipt?.items).toEqual([
      {
        title: "Telegram Messenger 750 Telegram Stars",
        price: 14.99,
        isSubscription: false,
      },
    ]);
  });

  test("adds tax to the subtotal when the renewal prints no total", () => {
    const receipt = parseAppleReceipt(FLAT_RENEWAL);
    expect(receipt?.orderId).toBe("MSSX2LX696");
    expect(receipt?.date).toBe("2026-08-30");
    expect(receipt?.total).toBeCloseTo(13.25, 2);
    expect(receipt?.items).toHaveLength(1);
    expect(receipt?.items[0]?.title).toContain(
      "HelloChinese Premium (Monthly)",
    );
    expect(receipt?.items[0]?.price).toBe(11.99);
    expect(receipt?.items[0]?.isSubscription).toBe(true);
  });

  test("takes the receipt date, not the renewal date printed beside it", () => {
    // "Renews September 20, 2026" sits in the same line as the receipt date.
    expect(parseAppleReceipt(FLAT_RENEWAL)?.date).toBe("2026-08-30");
  });

  test("finds the item when no subtotal separates it from the total", () => {
    const receipt = parseAppleReceipt(FLAT_NO_SUBTOTAL);
    expect(receipt?.total).toBe(2.99);
    // "Apple Account" recurs in the footer; a header marker found after the
    // prices must not become the start of the item region.
    expect(receipt?.items).toEqual([
      {
        title: "iCloud+ iCloud+ with 200 GB of Storage Monthly",
        price: 2.99,
        isSubscription: true,
      },
    ]);
  });

  test("stops the title before the device the purchase was made on", () => {
    const appPurchase =
      "Receipt APPLE ACCOUNT apple@example.com DATE Mar 20, 2026 " +
      "ORDER ID MSSX11AAAA DOCUMENT NO. 1234 " +
      "Dark Reader for Safari Dark Reader Ltd App Jerred\u{2019}s MacBook Pro " +
      "Report a Problem $4.99 Subtotal $4.99 Tax $0.53 TOTAL $5.52 " +
      "Get help with subscriptions. Apple Account \u{2022} Terms of Sale";
    const receipt = parseAppleReceipt(appPurchase);
    expect(receipt?.items[0]?.title).toBe(
      "Dark Reader for Safari Dark Reader Ltd",
    );
    expect(receipt?.total).toBe(5.52);
  });

  test("rejects mail that carries no order id", () => {
    expect(parseAppleReceipt("Your receipt from Apple. Thanks!")).toBeNull();
  });

  test("never reports a total read from the subtotal label", () => {
    const receipt = parseAppleReceipt(FLAT_STORE);
    expect(receipt?.total).not.toBe(14.99);
  });
});
