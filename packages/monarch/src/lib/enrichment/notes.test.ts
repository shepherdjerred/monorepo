import { describe, expect, test } from "vitest";
import {
  buildEnrichmentNote,
  planEnrichmentNotes,
  NOTE_PREFIX,
} from "./notes.ts";
import type { EnrichedTransaction } from "./types.ts";

describe("buildEnrichmentNote", () => {
  test("formats Amazon items", () => {
    const note = buildEnrichmentNote({
      items: [
        { title: "Anker Charger", price: 77.37 },
        { title: "LED Face Mask", price: 385.82 },
      ],
      enrichmentSource: "amazon",
    });
    expect(note).toBe(
      `${NOTE_PREFIX}Amazon: Anker Charger ($77.37), LED Face Mask ($385.82)`,
    );
  });

  test("labels Costco items as Costco", () => {
    const note = buildEnrichmentNote({
      items: [{ title: "TOPGOLF POSA", price: 79.99 }],
      enrichmentSource: "costco",
    });
    expect(note).toContain("Costco: TOPGOLF POSA");
  });

  test("formats Bilt bill breakdown", () => {
    const note = buildEnrichmentNote({
      billBreakdown: [
        { serviceType: "Rent", amount: -4000 },
        { serviceType: "Water", amount: -55.5 },
      ],
      enrichmentSource: "bilt",
    });
    expect(note).toBe(`${NOTE_PREFIX}Bilt bill: Rent $4000.00; Water $55.50`);
  });

  test("formats USAA insurance lines", () => {
    const note = buildEnrichmentNote({
      insuranceLines: [
        { policyType: "Auto Insurance", amount: 149.88 },
        { policyType: "Renters Insurance", amount: 80.7 },
      ],
      enrichmentSource: "usaa",
    });
    expect(note).toBe(
      `${NOTE_PREFIX}USAA: Auto Insurance $149.88; Renters Insurance $80.70`,
    );
  });

  test("formats Venmo payment context", () => {
    const note = buildEnrichmentNote({
      paymentNote: "dinner",
      paymentDirection: "sent",
      paymentCounterparty: "Alice",
      enrichmentSource: "venmo",
    });
    expect(note).toBe(`${NOTE_PREFIX}Venmo to Alice: "dinner"`);
  });

  test("returns undefined when there is nothing to say", () => {
    expect(buildEnrichmentNote({ enrichmentSource: "amazon" })).toBeUndefined();
    expect(
      buildEnrichmentNote({ items: [], enrichmentSource: "amazon" }),
    ).toBeUndefined();
  });
});

function enriched(
  notes: string,
  items = [{ title: "Widget", price: 9.99 }],
): EnrichedTransaction {
  return {
    transaction: {
      id: "t1",
      amount: -9.99,
      pending: false,
      date: "2026-01-01",
      hideFromReports: false,
      plaidName: "AMZN",
      notes,
      isRecurring: false,
      reviewStatus: "none",
      needsReview: false,
      isSplitTransaction: false,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
      category: { id: "c", name: "Shopping" },
      merchant: { id: "m", name: "Amazon", transactionsCount: 1 },
      account: { id: "a", displayName: "Card" },
      tags: [],
    },
    enrichment: { items, enrichmentSource: "amazon" },
    tier: 2,
    deepPath: "amazon",
  };
}

describe("planEnrichmentNotes", () => {
  test("plans a note for an unnoted transaction", () => {
    const planned = planEnrichmentNotes([enriched("")]);
    expect(planned).toHaveLength(1);
    expect(planned[0]?.replacing).toBe("none");
  });

  test("never touches a hand-written note", () => {
    expect(planEnrichmentNotes([enriched("my own note")])).toHaveLength(0);
  });

  test("is idempotent when the note already matches", () => {
    const note = "🧾 Amazon: Widget ($9.99)";
    expect(planEnrichmentNotes([enriched(note)])).toHaveLength(0);
  });

  test("flags replacement of an email-derived note", () => {
    const planned = planEnrichmentNotes([enriched("🧾 Email: something")]);
    expect(planned[0]?.replacing).toBe("email");
  });

  test("flags replacement of a stale vendor note", () => {
    const planned = planEnrichmentNotes([
      enriched("🧾 Amazon: Old item ($1.00)"),
    ]);
    expect(planned[0]?.replacing).toBe("pipeline");
  });
});
