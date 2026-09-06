import { describe, expect, test } from "vitest";
import {
  classifyCreationIntentConfirmation,
  classifyDareIntentConfirmation,
} from "#src/lib/intent-confirmation.ts";

describe("Dare intent confirmation presentation", () => {
  test("marks only the action's successful domain result as confirmed", () => {
    expect(classifyDareIntentConfirmation("fund", { kind: "funded" })).toEqual({
      status: "confirmed",
      message: "funded",
      retryable: false,
      deliveryWarning: null,
    });
    expect(
      classifyDareIntentConfirmation("fund", {
        kind: "insufficient",
        balance: 3,
        needed: 20,
      }),
    ).toEqual({
      status: "failed",
      message: "insufficient",
      retryable: true,
      deliveryWarning: null,
    });
  });

  test("recognizes an idempotent replay only when its stored result succeeded", () => {
    expect(
      classifyDareIntentConfirmation("accept", {
        kind: "already_consumed",
        result: { kind: "accepted", activated: true },
      }),
    ).toEqual({
      status: "confirmed",
      message: "accepted earlier",
      retryable: false,
      deliveryWarning: null,
    });
    expect(
      classifyDareIntentConfirmation("accept", {
        kind: "already_consumed",
        result: { kind: "wrong_state" },
      }).status,
    ).toBe("failed");
  });

  test("keeps feature and balance failures available for retry", () => {
    expect(
      classifyDareIntentConfirmation("contribute", {
        kind: "feature_disabled",
      }).retryable,
    ).toBe(true);
    expect(
      classifyDareIntentConfirmation("accept", { kind: "intent_expired" })
        .retryable,
    ).toBe(false);
  });

  test("separately warns when a committed action loses public delivery", () => {
    expect(
      classifyDareIntentConfirmation("fund", {
        kind: "funded",
        callout: "failed",
      }),
    ).toEqual({
      status: "confirmed",
      message: "funded",
      retryable: false,
      deliveryWarning:
        "The action committed, but Scout could not post or refresh the public Dare callout. Nothing was reversed; delivery will be retried.",
    });
  });
});

const GUILD_ID = "1337623164146155593";

describe("Creation intent confirmation presentation", () => {
  test("reads the created entity out of the answer, not out of the request", () => {
    // The card was minted for a report; the answer is what says what exists.
    expect(
      classifyCreationIntentConfirmation("report", {
        kind: "created",
        entity: "report",
        entityId: 7,
        guildId: GUILD_ID,
      }),
    ).toEqual({
      status: "confirmed",
      message: "Report created.",
      created: { entity: "report", entityId: 7, guildId: GUILD_ID },
    });
  });

  test("classifies every refusal the confirm procedure can answer with", () => {
    const refusals = [
      "limit_reached",
      "invalid_query",
      "invalid_configuration",
      "rate_limited",
      "missing_permission",
      "account_already_subscribed",
      "subscription_already_exists",
      "riot_id_not_found",
    ] as const;
    for (const kind of refusals) {
      expect(
        classifyCreationIntentConfirmation("competition", {
          kind,
          message: "Server said no.",
        }),
      ).toEqual({
        status: "failed",
        reason: kind,
        // The server's own sentence is what a person reads.
        message: "Server said no.",
      });
    }
  });

  test("answers the claim helper's own refusals without a server message", () => {
    expect(
      classifyCreationIntentConfirmation("subscription", {
        kind: "intent_expired",
      }),
    ).toEqual({
      status: "failed",
      reason: "intent_expired",
      message: "This confirmation expired before it was used.",
    });
  });

  test("replays a stored success as an already-created answer, keeping the link", () => {
    expect(
      classifyCreationIntentConfirmation("competition", {
        kind: "already_consumed",
        result: {
          kind: "created",
          entity: "competition",
          entityId: 12,
          guildId: GUILD_ID,
        },
      }),
    ).toEqual({
      status: "confirmed",
      message: "Competition was already created.",
      created: { entity: "competition", entityId: 12, guildId: GUILD_ID },
    });
  });

  test("replays a stored refusal as that refusal rather than as a replay", () => {
    // The intent is spent either way, so the reader needs the real reason.
    expect(
      classifyCreationIntentConfirmation("report", {
        kind: "already_consumed",
        result: { kind: "limit_reached", message: "That server is full." },
      }),
    ).toEqual({
      status: "failed",
      reason: "limit_reached",
      message: "That server is full.",
    });
  });

  test("reports a consumed intent with no readable answer as already used", () => {
    expect(
      classifyCreationIntentConfirmation("report", {
        kind: "already_consumed",
        result: null,
      }),
    ).toEqual({
      status: "failed",
      reason: "already_used",
      message: "Report confirmation has already been used.",
    });
  });

  test("refuses to read a malformed success as a creation", () => {
    // No entity id means no deep link, so calling this confirmed would offer a
    // link to nothing.
    expect(
      classifyCreationIntentConfirmation("report", {
        kind: "created",
        entity: "report",
        guildId: GUILD_ID,
      }),
    ).toEqual({
      status: "failed",
      reason: "unrecognized",
      message: "Scout could not confirm that.",
    });
    expect(
      classifyCreationIntentConfirmation("report", "nonsense").status,
    ).toBe("failed");
  });
});
