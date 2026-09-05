import { describe, expect, test } from "vitest";
import { readConfirmationIntentPayload } from "#src/lib/confirmation-intent/payload.ts";

const row = (kind: string, payload: string) => ({
  id: "3f1a0c8e-0000-4000-8000-000000000001",
  kind,
  payload,
});

describe("readConfirmationIntentPayload", () => {
  test("returns the parsed payload when both discriminators agree", () => {
    expect(
      readConfirmationIntentPayload(
        row("dare_contribute", '{"kind":"dare_contribute","amount":5}'),
      ),
    ).toEqual({ kind: "dare_contribute", amount: 5 });
  });

  test("refuses a row whose column and payload disagree", () => {
    // The executed action comes from the payload while status responses report
    // the column, so silently preferring either one would run something the
    // user was never shown — on a dare, something that moves real balances.
    expect(() =>
      readConfirmationIntentPayload(
        row("dare_decline", '{"kind":"dare_fund"}'),
      ),
    ).toThrow(
      /stores kind "dare_decline" but its payload declares "dare_fund"/,
    );
  });

  test("refuses a payload that is not a known intent shape", () => {
    expect(() =>
      readConfirmationIntentPayload(row("dare_fund", '{"kind":"nonsense"}')),
    ).toThrow();
  });
});
