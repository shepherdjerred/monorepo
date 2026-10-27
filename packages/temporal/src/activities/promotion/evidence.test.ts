import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { PromotionTaskJournal } from "./task.ts";
import { promotionTarget, promotionContent } from "./manifest.ts";
import { memoryPromotionStore } from "./test-support.ts";
import {
  recordPromotionDiagnostic,
  promotionDiagnosticKey,
} from "./diagnostic.ts";

function fixture() {
  const target = promotionTarget("pmc"),
    store = memoryPromotionStore();
  const journal = new PromotionTaskJournal({
    target,
    store,
    occurrenceId: "fixture",
    mode: "preview",
    enabled: () => Promise.resolve(false),
    now: Date.now,
    capture: () => Promise.reject(new Error("Preview cannot settle receipts")),
  });
  const observation = journal.observe({
    url: `${target.url}?view=owner`,
    text: JSON.stringify({
      snapshot: {
        nodes: [
          { ref: "e4", name: 'The Storm — "BUMP"\nAvailable' },
          { ref: "e5", name: "" },
        ],
      },
    }),
  });
  const draft = {
    status: "preview",
    summary: "Prepared native action",
    performedAction: false,
    nextEligibleAt: null,
    preparedContent: "Approved copy",
    receipt: null,
    evidence: [{ observationId: observation.reference, ref: "e4" }],
  };
  return { target, store, journal, observation, draft };
}
describe("captured promotion evidence", () => {
  it("resolves exact original text and URL without model transcription", () => {
    const test = fixture();
    expect(test.journal.resolveDraft(test.draft).evidence).toEqual([
      { url: test.observation.url, quote: 'The Storm — "BUMP"\nAvailable' },
    ]);
  });
  it("rejects foreign observations, absent refs and model-authored quotes", () => {
    const test = fixture();
    for (const evidence of [
      { observationId: crypto.randomUUID(), ref: "e4" },
      { observationId: test.observation.reference, ref: "e999" },
      { observationId: test.observation.reference, ref: "e5" },
      {
        observationId: test.observation.reference,
        ref: "e4",
        quote: "Invented success",
      },
    ])
      expect(() =>
        test.journal.resolveDraft({ ...test.draft, evidence: [evidence] }),
      ).toThrow();
  });
  it("resolves native Discord text references", () => {
    const test = fixture();
    const status = test.journal.observe({
      url: test.target.url,
      text: "Account: outreach\nCan send: true",
    });
    expect(
      test.journal.resolveDraft({
        ...test.draft,
        evidence: [{ observationId: status.reference, ref: "text" }],
      }).evidence[0]?.quote,
    ).toBe(status.text);
  });
  it("retains failed claims and captured evidence in private storage with redaction", async () => {
    const test = fixture();
    await recordPromotionDiagnostic({
      store: test.store,
      occurrenceId: "fixture",
      tokens: ["fixture-private-password"],
      diagnostic: {
        draft: test.draft,
        observations: test.journal.observations,
        error: "fixture-private-password",
      },
    });
    const saved = await test.store.read(
      promotionDiagnosticKey("fixture"),
      z.unknown(),
    );
    const data = JSON.stringify(saved?.value);
    expect(data).toContain(test.observation.id);
    expect(data).toContain("e4");
    expect(data).not.toContain("fixture-private-password");
  });
  it("assigns the existing approved title to supplemental Reddit destinations", async () => {
    const content = await promotionContent({
      ...promotionTarget("reddit-minecraftserver"),
      id: "reddit-minecraftsmps",
    });
    expect(content).toContain(
      "Assigned title: The Storm is rebuilding its survival community",
    );
    expect(content).toContain(
      "no additional community-specific title approval",
    );
  });
});
