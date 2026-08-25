import { describe, expect, test } from "vitest";
import { signatureHelpScoutQl } from "#src/model/scoutql/signature.ts";

// ── Signature help ───────────────────────────────────────────────────────────
// Help has to arrive while the call is still unfinished, so every fixture here
// is deliberately unclosed — a query that parses cleanly is the easy case.

function at(fixture: string): ReturnType<typeof signatureHelpScoutQl> {
  const offset = fixture.indexOf("|");
  expect(offset).toBeGreaterThanOrEqual(0);
  return signatureHelpScoutQl(fixture.replace("|", ""), offset);
}

describe("inside a call", () => {
  test("an unfinished call still gets help", () => {
    const help = at("SELECT QUANTILE_CONT(|");
    expect(help?.signatures[0]?.label).toBe("QUANTILE_CONT(x, q)");
    expect(help?.activeParameter).toBe(0);
  });

  test("the active parameter follows the commas", () => {
    expect(at("SELECT QUANTILE_CONT(kills, |")?.activeParameter).toBe(1);
    expect(at("SELECT QUANTILE_CONT(kills, 0.9|")?.activeParameter).toBe(1);
  });

  test("the active parameter is clamped to the signature", () => {
    expect(at("SELECT MEDIAN(kills, |")?.activeParameter).toBe(0);
  });

  test("COUNT picks the overload that has the argument being typed", () => {
    const empty = at("SELECT COUNT(|");
    expect(empty?.signatures).toHaveLength(3);
    expect(empty?.signatures[empty.activeSignature]?.label).toBe("COUNT(x)");
  });

  test("parameters carry their own documentation", () => {
    const help = at("SELECT QUANTILE_CONT(kills, |");
    expect(help?.signatures[0]?.parameters[1]?.documentation).toContain(
      "0 and 1",
    );
    expect(help?.signatures[0]?.documentation).toContain("quantile");
  });

  test("the innermost call wins", () => {
    const help = at("SELECT ROUND(QUANTILE_CONT(kills, |");
    expect(help?.signatures[0]?.label).toBe("QUANTILE_CONT(x, q)");
  });

  test("a closed inner call hands help back to the outer one", () => {
    const help = at("SELECT ROUND(QUANTILE_CONT(kills, 0.9), |");
    expect(help?.signatures[0]?.label).toBe("ROUND(x[, digits])");
    expect(help?.activeParameter).toBe(1);
  });

  test("macros and references have signatures too", () => {
    expect(
      at("SELECT COUNT(*) FROM x WHERE player(|")?.signatures[0]?.label,
    ).toBe("player('name')");
    expect(at("SELECT per_minute(|")?.signatures[0]?.label).toBe(
      "per_minute(x)",
    );
  });

  test("a FILTER body is not an argument list", () => {
    // The cursor is inside `FILTER (WHERE …)`, whose paren has no callee.
    expect(at("SELECT COUNT(*) FILTER (WHERE |")).toBeUndefined();
  });
});

describe("outside a call", () => {
  test.each([
    "SELECT |",
    "SELECT COUNT(*) AS games FROM |",
    "SELECT COUNT(*) |",
    "|",
    "SELECT nonsense(|",
    "SELECT COUNT(*) AS games FROM match_participants GROUP BY group(|",
  ])("%s has no signature help", (fixture) => {
    expect(at(fixture)).toBeUndefined();
  });
});
