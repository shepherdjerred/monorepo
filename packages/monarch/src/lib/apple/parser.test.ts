import { describe, expect, test } from "bun:test";
import { parseAppleReceipt, parseAppleDate } from "./parser.ts";

describe("parseAppleDate", () => {
  test("parses standard Apple date", () => {
    expect(parseAppleDate("Mar 4, 2022")).toBe("2022-03-04");
  });

  test("parses date with double-digit day", () => {
    expect(parseAppleDate("Dec 15, 2023")).toBe("2023-12-15");
  });

  test("returns input for unparseable date", () => {
    expect(parseAppleDate("invalid")).toBe("invalid");
  });
});

describe("parseAppleReceipt", () => {
  test("parses a receipt with items", () => {
    const eml = [
      "Subject: Your receipt from Apple.",
      "Content-Type: text/plain",
      "",
      "ORDER ID:              MSSN309W58",
      "DATE:                 Mar 4, 2022",
      "TOTAL:                     $14.32",
      "",
      "App Store",
      "-----------",
      "Headspace: Mindful Meditation    $12.99",
      "Monthly Subscription (Monthly)",
      "Renews Apr 1, 2022",
      "",
      "Tax    $1.33",
    ].join("\n");

    const receipt = parseAppleReceipt(eml);
    expect(receipt).not.toBeNull();
    expect(receipt?.orderId).toBe("MSSN309W58");
    expect(receipt?.date).toBe("2022-03-04");
    expect(receipt?.total).toBe(14.32);
    expect(receipt?.items).toHaveLength(1);
    expect(receipt?.items[0]?.title).toBe("Headspace: Mindful Meditation");
    expect(receipt?.items[0]?.price).toBe(12.99);
    expect(receipt?.items[0]?.isSubscription).toBe(true);
  });

  test("parses multiple items", () => {
    const eml = [
      "Subject: Your receipt from Apple.",
      "",
      "ORDER ID:              ABC123",
      "DATE:                 Jan 15, 2023",
      "TOTAL:                     $25.97",
      "",
      "iCloud+ 200GB    $2.99",
      "Monthly Subscription",
      "Apple Music    $10.99",
      "Monthly Subscription",
      "Apple TV+    $6.99",
      "Monthly Subscription",
      "Some App    $4.99",
      "One-time purchase",
    ].join("\n");

    const receipt = parseAppleReceipt(eml);
    expect(receipt).not.toBeNull();
    expect(receipt?.items).toHaveLength(4);
    expect(receipt?.items[0]?.title).toBe("iCloud+ 200GB");
    expect(receipt?.items[1]?.title).toBe("Apple Music");
    expect(receipt?.items[2]?.title).toBe("Apple TV+");
    expect(receipt?.items[3]?.title).toBe("Some App");
  });

  test("returns null for non-receipt email", () => {
    const eml = [
      "Subject: Hello",
      "",
      "This is not a receipt.",
    ].join("\n");

    expect(parseAppleReceipt(eml)).toBeNull();
  });

  test("handles MIME multipart", () => {
    const eml = [
      'Content-Type: multipart/alternative; boundary="boundary123"',
      "",
      "--boundary123",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      "ORDER ID:              MIME001",
      "DATE:                 Feb 1, 2024",
      "TOTAL:                     $9.99",
      "",
      "iCloud+ 50GB    $0.99",
      "Monthly Subscription",
      "",
      "--boundary123",
      "Content-Type: text/html; charset=UTF-8",
      "",
      "<html>stuff</html>",
      "--boundary123--",
    ].join("\n");

    const receipt = parseAppleReceipt(eml);
    expect(receipt).not.toBeNull();
    expect(receipt?.orderId).toBe("MIME001");
    expect(receipt?.items).toHaveLength(1);
  });
});
