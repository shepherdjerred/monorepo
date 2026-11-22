import { describe, expect, it } from "vitest";
import {
  groupNotifications,
  unreadCount,
} from "#client/notifications/model.ts";
import {
  DELIVERY_STATES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_KINDS,
} from "#client/presentation/notification.ts";
import { NotificationListSchema } from "#shared/api.ts";
import type { Persona } from "./personas.ts";
import { routeFixture } from "./router.ts";
import type { FixtureScenario } from "./scenario.ts";

/** The notification list, as the client reads it. */
function read(persona: Persona, scenario: FixtureScenario = "default") {
  const outcome = routeFixture({
    method: "GET",
    url: new URL("http://fixture.invalid/api/v1/notifications"),
    persona,
    scenario,
  });
  if (outcome.status !== 200) {
    throw new Error(`/notifications: HTTP ${String(outcome.status)}`);
  }
  return NotificationListSchema.parse(outcome.body);
}

/** The deliveries to the household's shared Discord channel. */
function shared(persona: Persona) {
  return read(persona).filter((row) => row.channel === "discord_shared");
}

describe("the notification fixture", () => {
  it("sends only kinds, channels and states the server does, and every one of them", () => {
    const rows = read("owner");
    // Grouping reads each of the three, and fails on one it does not know.
    const events = groupNotifications(rows);
    expect(new Set(events.map((event) => event.kind))).toEqual(
      new Set(NOTIFICATION_KINDS),
    );
    expect(new Set(rows.map((row) => row.channel))).toEqual(
      new Set(NOTIFICATION_CHANNELS),
    );
    expect(new Set(rows.map((row) => row.state))).toEqual(
      new Set(DELIVERY_STATES),
    );
  });

  it("has an unread reminder and a read one, each delivered on two channels", () => {
    for (const persona of ["member", "owner"] as const) {
      const rows = read(persona);
      expect(unreadCount(rows), persona).toBe(1);
      const warnings = groupNotifications(rows).filter(
        (event) => event.kind === "retention_warning",
      );
      expect(warnings.map((event) => event.unread !== null)).toEqual([
        true,
        false,
      ]);
      for (const warning of warnings) {
        expect(warning.deliveries.map((row) => row.channel)).toEqual([
          "in_app",
          "email",
        ]);
      }
    }
  });

  it("records the household's shared announcement against the owner, naming no item", () => {
    expect(shared("member")).toEqual([]);
    const rows = shared("owner");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.event).toMatchObject({
      kind: "media_available",
      mediaId: null,
      media: null,
    });
  });

  it("lists nothing for a household that has been told nothing", () => {
    expect(read("member", "new-household")).toEqual([]);
    expect(read("owner", "new-household")).toEqual([]);
  });
});
