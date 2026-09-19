import { describe, expect, test } from "vitest";
import { NotificationIntentKindSchema } from "@scout-for-lol/domain/notifications/intent.ts";
import {
  SCOUT_V2_NOTIFICATION_RENDER_RECEIPT_KINDS,
  scoutV2NotificationRenderReceiptKind,
} from "#src/temporal/v2/notification-receipts.ts";

describe("the V2 notification render receipt kind", () => {
  test("is distinct per intent kind", () => {
    // A prematch and a postmatch intent name the same match id and render
    // different images; one receipt kind for both would let whichever
    // rendered first stand for the other, and a post-match report would be
    // delivered carrying the loading screen.
    const kinds = NotificationIntentKindSchema.options.map((kind) =>
      scoutV2NotificationRenderReceiptKind(kind),
    );
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  test("stays inside the receipt kind vocabulary", () => {
    for (const kind of NotificationIntentKindSchema.options) {
      expect(scoutV2NotificationRenderReceiptKind(kind)).toMatch(
        /^v2-notification-render-[a-z-]+$/u,
      );
    }
  });

  test("names every intent kind and nothing else", () => {
    expect(
      Object.keys(SCOUT_V2_NOTIFICATION_RENDER_RECEIPT_KINDS).sort(),
    ).toEqual([...NotificationIntentKindSchema.options].sort());
  });
});
