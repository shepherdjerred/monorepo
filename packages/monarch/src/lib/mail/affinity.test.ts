import { describe, expect, test } from "vitest";
import {
  tokenize,
  compactMerchant,
  senderDomainLabels,
  affinityScore,
} from "./affinity.ts";
import type { EmailIndexEntry } from "./types.ts";
import type { MonarchTransaction } from "../monarch/types.ts";

function makeTxn(merchant: string, plaid = merchant): MonarchTransaction {
  return {
    id: "t1",
    amount: -20,
    pending: false,
    date: "2026-01-10",
    hideFromReports: false,
    plaidName: plaid,
    notes: "",
    isRecurring: false,
    reviewStatus: "none",
    needsReview: false,
    isSplitTransaction: false,
    createdAt: "2026-01-10",
    updatedAt: "2026-01-10",
    category: { id: "c", name: "Shopping" },
    merchant: { id: "m", name: merchant, transactionsCount: 1 },
    account: { id: "a", displayName: "Card" },
    tags: [],
  };
}

function makeEntry(from: string, subject = ""): EmailIndexEntry {
  return {
    path: "/dev/null",
    account: "root",
    mailbox: "Archive.mailbox",
    from,
    subject,
    date: "2026-01-10",
  };
}

describe("tokenize", () => {
  test("lowercases and drops stopwords, short tokens, and bare numbers", () => {
    const tokens = tokenize("DoorDash Order No-Reply 123");
    expect(tokens.has("doordash")).toBe(true);
    expect(tokens.has("order")).toBe(false);
    expect(tokens.has("123")).toBe(false);
    expect(tokens.has("no")).toBe(false);
  });
});

describe("compactMerchant", () => {
  test("removes separators and punctuation", () => {
    expect(compactMerchant("America's Test Kitchen")).toBe(
      "americastestkitchen",
    );
    expect(compactMerchant("Best Buy")).toBe("bestbuy");
  });

  test("strips processor prefixes and trailing store numbers", () => {
    expect(compactMerchant("SQ *BLUE BOTTLE")).toBe("bluebottle");
    expect(compactMerchant("SAFEWAY #1234")).toBe("safeway");
  });
});

describe("senderDomainLabels", () => {
  test("keeps brand labels and drops ESP/TLD noise", () => {
    expect(senderDomainLabels("BestBuy <x@emailinfo.bestbuy.com>")).toContain(
      "bestbuy",
    );
    expect(senderDomainLabels("a@email.ticketmaster.com")).toContain(
      "ticketmaster",
    );
    expect(senderDomainLabels("a@email.ticketmaster.com").has("email")).toBe(
      false,
    );
  });

  test("handles brand TLDs and hyphenated labels", () => {
    const apple = senderDomainLabels("Apple <no_reply@post.applecard.apple>");
    expect(apple.has("applecard")).toBe(true);
    expect(apple.has("apple")).toBe(true);
    expect(senderDomainLabels("x@c-openai.com").has("openai")).toBe(true);
  });

  test("returns an empty set when there is no address", () => {
    expect(senderDomainLabels("not an address").size).toBe(0);
  });
});

describe("affinityScore — the merchants that used to score 0", () => {
  const cases: [string, string, string, string][] = [
    [
      "Best Buy",
      "BEST BUY #1234",
      "BestBuy <x@emailinfo.bestbuy.com>",
      "Your order",
    ],
    [
      "Steam",
      "STEAMGAMES.COM",
      "Steam <noreply@steampowered.com>",
      "Your Steam purchase",
    ],
    [
      "America's Test Kitchen",
      "AMERICASTESTKITCHE",
      "ATK <x@americastestkitchen.com>",
      "receipt",
    ],
    [
      "The Home Depot",
      "THE HOME DEPOT #42",
      "Home Depot <x@order.homedepot.com>",
      "Order confirmation",
    ],
    ["OpenAI", "OPENAI *CHATGPT", "OpenAI <x@tm.openai.com>", "Your receipt"],
    ["eBay", "EBAY O*12-34567", "eBay <x@members.ebay.com>", "Order confirmed"],
    [
      "Ticketmaster",
      "TICKETMASTER",
      "Ticketmaster <x@email.ticketmaster.com>",
      "Your tickets",
    ],
    [
      "Airbnb",
      "AIRBNB * HM123",
      "Airbnb <x@supportmessaging.airbnb.com>",
      "Your trip",
    ],
    ["DoorDash", "DD *DOORDASH", "DoorDash <x@doordash.com>", "Order receipt"],
  ];

  for (const [merchant, plaid, from, subject] of cases) {
    test(`${merchant} scores above the candidate threshold`, () => {
      expect(
        affinityScore(makeTxn(merchant, plaid), makeEntry(from, subject)),
      ).toBeGreaterThanOrEqual(2);
    });
  }
});

describe("affinityScore — guards against over-matching", () => {
  test("unrelated merchant and sender score zero", () => {
    expect(
      affinityScore(
        makeTxn("Shell", "SHELL OIL 5744"),
        makeEntry("Uber Receipts <noreply@uber.com>", "Your Tuesday trip"),
      ),
    ).toBe(0);
  });

  test("short merchant names match only exactly, never by containment", () => {
    // "amc" must not match "dynamics" by interior containment
    expect(
      affinityScore(
        makeTxn("AMC", "AMC #4321"),
        makeEntry("Dynamics <x@dynamicsmarket.com>", "newsletter"),
      ),
    ).toBe(0);
  });

  test("a generic marketing sender does not match a short brand", () => {
    expect(
      affinityScore(
        makeTxn("Target", "TARGET 00012345"),
        makeEntry("Marketing <targeting@marketing-updates.com>", "deals"),
      ),
    ).toBe(0);
  });

  test("scores are non-negative integers and deterministic", () => {
    const txn = makeTxn("Best Buy", "BEST BUY #1234");
    const entry = makeEntry("BestBuy <x@emailinfo.bestbuy.com>", "Your order");
    const first = affinityScore(txn, entry);
    expect(first).toBe(affinityScore(txn, entry));
    expect(Number.isInteger(first)).toBe(true);
    expect(first).toBeGreaterThanOrEqual(0);
  });
});

describe("affinityScore — aliases", () => {
  test("Uber Eats matches uber.com", () => {
    expect(
      affinityScore(
        makeTxn("Uber Eats", "UBER *EATS"),
        makeEntry("Uber Eats <x@uber.com>", "Your order"),
      ),
    ).toBeGreaterThanOrEqual(4);
  });

  test("Whole Foods matches a Whole Foods sender through its bank name", () => {
    expect(
      affinityScore(
        makeTxn("Whole Foods", "WHOLEFDS MKT 123"),
        makeEntry(
          "Whole Foods Market <x@wholefoodsmarket.com>",
          "Your receipt",
        ),
      ),
    ).toBeGreaterThanOrEqual(3);
  });

  test("a Whole Foods charge is not pulled toward ordinary Amazon mail", () => {
    // Amazon owns Whole Foods, but an amazon.com order email never documents a
    // grocery charge. Shortlisting one costs a judgment to be told no.
    expect(
      affinityScore(
        makeTxn("Whole Foods", "WHOLEFDS MKT 123"),
        makeEntry("Amazon <x@amazon.com>", "Your order has shipped"),
      ),
    ).toBe(0);
  });
});
