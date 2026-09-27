import { Database } from "bun:sqlite";
import { costForTextUsage } from "@shepherdjerred/llm-models";
import { z } from "zod";

const MODEL = "gpt-6-luna";
const MAX_INPUT_TOKENS = 2000;
const MAX_OUTPUT_TOKENS = 150;
export const MONTHLY_CAP_MICRO_USD = 20_000_000;

const Row = z.object({ spent: z.number().int().nonnegative() });
const ReservationRow = z.object({
  month: z.string(),
  estimate: z.number().int().positive(),
});

function monthInPacific(instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(instant);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  if (year === undefined || month === undefined) {
    throw new Error("cannot determine Pacific billing month");
  }
  return `${year}-${month}`;
}

export function maximumTurnMicroUsd(): number {
  const usd = costForTextUsage(MODEL, {
    inputTokens: MAX_INPUT_TOKENS,
    outputTokens: MAX_OUTPUT_TOKENS,
  });
  if (usd === undefined) {
    throw new Error("GPT-6 Luna has no catalog price");
  }
  return Math.ceil(usd * 1_000_000);
}

/** Durable, fail-closed app cap. An unsettled reservation remains charged. */
export class MonthlyBudget {
  readonly #db: Database;
  readonly #limit: number;

  constructor(path: string, limit = MONTHLY_CAP_MICRO_USD) {
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new Error("invalid monthly budget");
    }
    this.#db = new Database(path, { create: true });
    this.#limit = limit;
    this.#db.run(
      "CREATE TABLE IF NOT EXISTS monthly_spend (month TEXT PRIMARY KEY, spent INTEGER NOT NULL CHECK (spent >= 0))",
    );
    this.#db.run(
      "CREATE TABLE IF NOT EXISTS reservations (id TEXT PRIMARY KEY, month TEXT NOT NULL, estimate INTEGER NOT NULL CHECK (estimate > 0), state TEXT NOT NULL CHECK (state IN ('open', 'settled'))) ",
    );
  }

  reserve(instant: Date, id: string): boolean {
    if (id.length === 0) throw new Error("reservation id is required");
    const month = monthInPacific(instant);
    const estimate = maximumTurnMicroUsd();
    return this.#db.transaction(() => {
      if (
        this.#db.query("SELECT id FROM reservations WHERE id = ?").get(id) !==
        null
      ) {
        throw new Error("duplicate budget reservation");
      }
      this.#db
        .query(
          "INSERT OR IGNORE INTO monthly_spend(month, spent) VALUES (?, 0)",
        )
        .run(month);
      const spent = Row.parse(
        this.#db
          .query("SELECT spent FROM monthly_spend WHERE month = ?")
          .get(month),
      ).spent;
      const open = z
        .object({ total: z.number().int().nonnegative() })
        .parse(
          this.#db
            .query(
              "SELECT COALESCE(SUM(estimate), 0) AS total FROM reservations WHERE month = ? AND state = 'open'",
            )
            .get(month),
        ).total;
      if (spent + open + estimate > this.#limit) return false;
      this.#db
        .query(
          "INSERT INTO reservations(id, month, estimate, state) VALUES (?, ?, ?, 'open')",
        )
        .run(id, month, estimate);
      return true;
    })();
  }

  settle(id: string, inputTokens: number, outputTokens: number): void {
    if (
      !Number.isSafeInteger(inputTokens) ||
      inputTokens < 0 ||
      !Number.isSafeInteger(outputTokens) ||
      outputTokens < 0
    ) {
      throw new Error("invalid model usage");
    }
    const actualUsd = costForTextUsage(MODEL, { inputTokens, outputTokens });
    if (actualUsd === undefined)
      throw new Error("GPT-6 Luna has no catalog price");
    const actual = Math.ceil(actualUsd * 1_000_000);
    const exceeded = this.#db.transaction(() => {
      const reservation = ReservationRow.parse(
        this.#db
          .query(
            "SELECT month, estimate FROM reservations WHERE id = ? AND state = 'open'",
          )
          .get(id),
      );
      this.#db
        .query("UPDATE monthly_spend SET spent = spent + ? WHERE month = ?")
        .run(actual, reservation.month);
      this.#db
        .query("UPDATE reservations SET state = 'settled' WHERE id = ?")
        .run(id);
      return actual > reservation.estimate;
    })();
    if (exceeded) throw new Error("model usage exceeded reserved maximum");
  }

  close(): void {
    this.#db.close();
  }
}
