import { describe, expect, test } from "vitest";
import { NotificationIntentKindSchema } from "@scout-for-lol/domain/notifications/intent.ts";
import {
  SCOUT_NOTIFICATION_RENDER_RECEIPT_KINDS,
  scoutNotificationRenderReceiptKind,
} from "#src/temporal/notification-lane/notification-receipts.ts";

describe("the V2 notification render receipt kind", () => {
  const matchKinds = NotificationIntentKindSchema.options.filter(
    (kind) => kind !== "duel-status" && kind !== "dare-status",
  );
  test("is distinct per intent kind", () => {
    // A prematch and a postmatch intent name the same match id and render
    // different images; one receipt kind for both would let whichever
    // rendered first stand for the other, and a post-match report would be
    // delivered carrying the loading screen.
    const kinds = matchKinds.map((kind) =>
      scoutNotificationRenderReceiptKind(kind),
    );
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  test("stays inside the receipt kind vocabulary", () => {
    for (const kind of matchKinds) {
      expect(scoutNotificationRenderReceiptKind(kind)).toMatch(
        /^v2-notification-render-[a-z-]+$/u,
      );
    }
  });

  test("names every intent kind and nothing else", () => {
    expect(Object.keys(SCOUT_NOTIFICATION_RENDER_RECEIPT_KINDS).sort()).toEqual(
      [...matchKinds].sort(),
    );
  });
});
