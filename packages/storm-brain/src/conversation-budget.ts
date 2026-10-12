import { Database } from "bun:sqlite";
import { costForTextUsage } from "@shepherdjerred/llm-models";
import {
  MAX_CORRECTIVE_PROMPT_CHARS,
  MAX_SEMANTIC_ATTEMPTS,
} from "@shepherdjerred/llm-runtime";
import { z } from "zod";
import { conversationContract } from "./conversation-schema.ts";

const AmountRow = z.object({ amount: z.number().int().nonnegative() });
const ReservationRow = z.object({
  month: z.string(),
  estimate: z.number().int().positive(),
});
export class ConversationBudgetError extends Error {}

export function maximumReplyMicroUsd(
  model: string,
  prompt: string,
  system: string,
): number {
  // UTF-8 bytes bound token count. Include schema/provider framing and the largest corrective
  // prompt, plus all semantic attempts and a conservative transport-retry allowance.
  const input =
    Buffer.byteLength(prompt + system) + MAX_CORRECTIVE_PROMPT_CHARS * 4 + 4096;
  const cost = costForTextUsage(model, {
    inputTokens: input,
    outputTokens: conversationContract.maxOutputTokens,
    cacheReadTokens: input,
    cacheWriteTokens: input,
  });
  if (cost === undefined)
    throw new Error("conversation model lacks catalog pricing");
  return Math.max(1, Math.ceil(cost * 1_000_000 * MAX_SEMANTIC_ATTEMPTS * 3));
}

/** A single SQLite transaction reserves shared spend before contacting a provider. */
export class ConversationBudget {
  readonly #db: Database;
  readonly #limit: number;
  constructor(
    path: string,
    limit = conversationContract.monthlyBudgetMicroUsd,
  ) {
    if (
      !Number.isSafeInteger(limit) ||
      limit < 0 ||
      limit > conversationContract.monthlyBudgetMicroUsd
    )
      throw new Error("invalid companion budget");
    this.#limit = limit;
    this.#db = new Database(path, { create: true, strict: true });
    this.#db.run("PRAGMA journal_mode=WAL");
    this.#db.run("PRAGMA synchronous=FULL");
    this.#db.run("PRAGMA busy_timeout=5000");
    this.#db.run(
      "CREATE TABLE IF NOT EXISTS companion_spend (month TEXT PRIMARY KEY, spent INTEGER NOT NULL CHECK(spent >= 0))",
    );
    this.#db.run(
      "CREATE TABLE IF NOT EXISTS companion_reservations (id TEXT PRIMARY KEY, month TEXT NOT NULL, estimate INTEGER NOT NULL CHECK(estimate > 0), settled INTEGER NOT NULL CHECK(settled IN(0,1)))",
    );
  }
  reserve(now: Date, id: string, estimate: number): void {
    if (!Number.isSafeInteger(estimate) || estimate <= 0)
      throw new Error("invalid conversation reservation");
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: conversationContract.timeZone,
      year: "numeric",
      month: "2-digit",
    }).formatToParts(now);
    const year = parts.find((part) => part.type === "year")?.value;
    const monthNumber = parts.find((part) => part.type === "month")?.value;
    if (year === undefined || monthNumber === undefined)
      throw new Error("cannot resolve budget month");
    const month = `${year}-${monthNumber}`;
    this.#db
      .transaction(() => {
        if (
          this.#db
            .query("SELECT id FROM companion_reservations WHERE id=?")
            .get(id) !== null
        )
          throw new ConversationBudgetError(
            "conversation request was already reserved",
          );
        this.#db
          .query("INSERT OR IGNORE INTO companion_spend VALUES (?,0)")
          .run(month);
        const spent = AmountRow.parse(
          this.#db
            .query("SELECT spent AS amount FROM companion_spend WHERE month=?")
            .get(month),
        ).amount;
        const pending = AmountRow.parse(
          this.#db
            .query(
              "SELECT COALESCE(SUM(estimate),0) AS amount FROM companion_reservations WHERE month=? AND settled=0",
            )
            .get(month),
        ).amount;
        if (spent + pending + estimate > this.#limit)
          throw new ConversationBudgetError(
            "monthly companion conversation budget exhausted",
          );
        this.#db
          .query("INSERT INTO companion_reservations VALUES (?,?,?,0)")
          .run(id, month, estimate);
      })
      .immediate();
  }
  settle(id: string, actual: number): void {
    if (!Number.isSafeInteger(actual) || actual < 0)
      throw new Error("invalid conversation cost");
    const exceeded = this.#db
      .transaction(() => {
        const row = ReservationRow.parse(
          this.#db
            .query(
              "SELECT month,estimate FROM companion_reservations WHERE id=? AND settled=0",
            )
            .get(id),
        );
        this.#db
          .query("UPDATE companion_spend SET spent=spent+? WHERE month=?")
          .run(actual > row.estimate ? this.#limit : actual, row.month);
        this.#db
          .query("UPDATE companion_reservations SET settled=1 WHERE id=?")
          .run(id);
        return actual > row.estimate;
      })
      .immediate();
    if (exceeded)
      throw new Error(
        "conversation usage exceeded reserved bound; monthly budget disabled",
      );
  }
  close(): void {
    this.#db.close();
  }
}
