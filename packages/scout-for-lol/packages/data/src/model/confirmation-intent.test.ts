import { describe, expect, test } from "vitest";
import {
  ConfirmationIntentKindSchema,
  ConfirmationIntentPayloadSchema,
  CreationIntentKindSchema,
} from "#src/model/confirmation-intent.ts";

const GUILD = "100000000000000001";
const CHANNEL = "200000000000000001";
const QUERY =
  "SELECT player, COUNT(*) AS games FROM match_participants GROUP BY player RENDER table";

describe("report_update confirmation intent", () => {
  test("a full ReportCreateInput-shaped edit parses", () => {
    const payload = ConfirmationIntentPayloadSchema.parse({
      kind: "report_update",
      guildId: GUILD,
      reportId: 42,
      title: "Weekly wins",
      description: null,
      channelId: CHANNEL,
      queryText: QUERY,
      cronExpression: "0 12 * * 1",
      scheduleTimezone: "UTC",
      isEnabled: false,
    });
    expect(payload.kind).toBe("report_update");
    if (payload.kind !== "report_update") return;
    expect(payload.reportId).toBe(42);
    expect(payload.title).toBe("Weekly wins");
  });

  test("a partial edit with only a queryText rewrite parses", () => {
    const payload = ConfirmationIntentPayloadSchema.parse({
      kind: "report_update",
      guildId: GUILD,
      reportId: 7,
      queryText: QUERY,
    });
    expect(payload.kind).toBe("report_update");
  });

  test("report_update is a creation-family kind", () => {
    expect(CreationIntentKindSchema.parse("report_update")).toBe(
      "report_update",
    );
    expect(ConfirmationIntentKindSchema.parse("report_update")).toBe(
      "report_update",
    );
  });

  test("an unknown field is refused", () => {
    expect(() =>
      ConfirmationIntentPayloadSchema.parse({
        kind: "report_update",
        guildId: GUILD,
        reportId: 7,
        ownerId: "300000000000000001",
      }),
    ).toThrow();
  });

  test("a non-positive reportId is refused", () => {
    expect(() =>
      ConfirmationIntentPayloadSchema.parse({
        kind: "report_update",
        guildId: GUILD,
        reportId: 0,
        title: "Nope",
      }),
    ).toThrow();
  });

  test("existing create and dare arms still parse (additive)", () => {
    expect(
      ConfirmationIntentPayloadSchema.parse({
        kind: "report",
        guildId: GUILD,
        title: "Weekly",
        description: null,
        channelId: CHANNEL,
        queryText: QUERY,
        cronExpression: "0 0 * * 0",
        scheduleTimezone: "UTC",
        isEnabled: true,
      }).kind,
    ).toBe("report");
    expect(
      ConfirmationIntentPayloadSchema.parse({ kind: "dare_publish" }).kind,
    ).toBe("dare_publish");
  });
});
