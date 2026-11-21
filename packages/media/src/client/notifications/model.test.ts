import { expect, test } from "vitest";
import { NotificationListSchema } from "#shared/api.ts";
import {
  deliveryOutcome,
  DELIVERY_CAP,
  groupNotifications,
  isCutOff,
  needsAttention,
  notificationTitle,
  unreadCount,
  type Delivery,
} from "./model.ts";

type Event = Delivery["event"];

const FILM = {
  id: "film-1",
  rootMediaId: "film-1",
  rootTitle: "Dune: Part Two",
  kind: "movie",
  title: "Dune: Part Two",
  artwork: { posterPath: "/poster.jpg", backdropPath: null },
} as const;

function event(id: string, overrides: Partial<Event> = {}): Event {
  return {
    id,
    mediaId: FILM.id,
    kind: "media_available",
    media: FILM,
    ...overrides,
  };
}

let sequence = 0;

/** One row of the list: an event on one channel. */
function row(
  about: Event,
  channel: string,
  overrides: Partial<Omit<Delivery, "event" | "channel">> = {},
): Delivery {
  sequence += 1;
  const [parsed] = NotificationListSchema.parse([
    {
      id: `delivery-${String(sequence)}`,
      channel,
      state: "accepted",
      version: 1,
      failureReason: null,
      providerStatus: null,
      attempts: 1,
      acceptedAt: "2026-11-20T10:00:00.000Z",
      createdAt: "2026-11-20T09:57:00.000Z",
      event: about,
      ...overrides,
    },
  ]);
  if (parsed === undefined) throw new Error("The row did not parse");
  return parsed;
}

test("rows that share an event are one notification, with its channels in a fixed order", () => {
  const available = event("event-1");
  const groups = groupNotifications([
    row(available, "discord"),
    row(available, "email", { providerStatus: "delivered" }),
    row(event("event-2", { kind: "subtitles_ready" }), "email"),
  ]);
  expect(groups.map((group) => group.id)).toEqual(["event-1", "event-2"]);
  expect(groups[0]?.deliveries.map((delivery) => delivery.channel)).toEqual([
    "email",
    "discord",
  ]);
  expect(groups[0]?.kind).toBe("media_available");
  expect(groups[1]?.deliveries).toHaveLength(1);
});

test("two events of one kind about one title, queued at the same moment, stay two notifications", () => {
  const groups = groupNotifications([
    row(event("event-b"), "email"),
    row(event("event-a"), "email"),
    row(event("event-b"), "discord"),
  ]);
  expect(groups.map((group) => group.id)).toEqual(["event-b", "event-a"]);
  expect(groups.map((group) => group.deliveries.length)).toEqual([2, 1]);
});

test("notifications keep the order their newest row arrived in, and take its time", () => {
  const older = event("older");
  const newer = event("newer");
  const groups = groupNotifications([
    row(newer, "email", { createdAt: "2026-11-21T08:00:00.000Z" }),
    row(older, "email", { createdAt: "2026-11-20T08:00:00.000Z" }),
    row(newer, "discord", { createdAt: "2026-11-21T08:00:00.000Z" }),
    row(older, "in_app", { createdAt: "2026-11-20T08:00:00.000Z" }),
  ]);
  expect(groups.map((group) => [group.id, group.createdAt])).toEqual([
    ["newer", "2026-11-21T08:00:00.000Z"],
    ["older", "2026-11-20T08:00:00.000Z"],
  ]);
  expect(groupNotifications([])).toEqual([]);
});

test("a notification is unread while its reminder in Media waits to be read", () => {
  const leaving = event("leaving", { kind: "retention_warning" });
  const waiting = [
    row(leaving, "email", { providerStatus: "delivered" }),
    row(leaving, "in_app", { state: "pending", acceptedAt: null }),
    row(event("ready"), "email"),
  ];
  const [first, second] = groupNotifications(waiting);
  expect(first?.unread?.channel).toBe("in_app");
  expect(second?.unread).toBeNull();
  expect(unreadCount(waiting)).toBe(1);

  // Read: the same delivery, accepted and viewed.
  const read = [
    row(leaving, "email", { providerStatus: "delivered" }),
    row(leaving, "in_app", { providerStatus: "viewed" }),
  ];
  expect(groupNotifications(read)[0]?.unread).toBeNull();
  expect(unreadCount(read)).toBe(0);
  // An email that has not gone out yet is not something to read here.
  expect(
    unreadCount([row(event("queued"), "email", { state: "pending" })]),
  ).toBe(0);
  // Two unread events count twice; one event counts once.
  expect(
    unreadCount([
      row(leaving, "in_app", { state: "pending" }),
      row(event("other", { kind: "retention_warning" }), "in_app", {
        state: "pending",
      }),
    ]),
  ).toBe(2);
});

/** The sentence of a notification about one event. */
function titled(overrides: Partial<Event>): string {
  const [group] = groupNotifications([row(event("e", overrides), "email")]);
  if (group === undefined) throw new Error("No notification");
  return notificationTitle(group);
}

test("a sentence names the title an event is about, and says nothing it does not know", () => {
  expect(titled({})).toBe("Dune: Part Two is ready to watch");
  expect(titled({ kind: "media_upgraded" })).toBe(
    "A better version of Dune: Part Two arrived",
  );
  expect(titled({ kind: "subtitles_ready" })).toBe(
    "Subtitles for Dune: Part Two are ready",
  );
  expect(titled({ kind: "files_quarantined" })).toBe(
    "Dune: Part Two was removed and can still be restored",
  );
  expect(titled({ kind: "files_purged" })).toBe(
    "Dune: Part Two was removed for good",
  );
  expect(titled({ kind: "acquisition_failed" })).toBe(
    "Media could not get Dune: Part Two",
  );
  expect(titled({ kind: "interest_check" })).toBe(
    "Still watching Dune: Part Two?",
  );
  expect(titled({ kind: "retention_warning" })).toBe(
    "Dune: Part Two is leaving soon",
  );
  // An episode is named as one, and still starts the sentence in capitals.
  const episode = {
    ...FILM,
    id: "episode-7",
    rootTitle: "The Bear",
    kind: "episode",
    title: "Bears",
  } as const;
  // An episode is named with its series, and still starts in capitals.
  expect(titled({ media: episode })).toBe(
    "The episode “Bears” of The Bear is ready to watch",
  );
  expect(titled({ kind: "media_upgraded", media: episode })).toBe(
    "A better version of the episode “Bears” of The Bear arrived",
  );
  // An episode known only by its number is not quoted as if it were a name.
  const numbered = { ...episode, title: "Episode 4" };
  expect(titled({ media: numbered })).toBe(
    "Episode 4 of The Bear is ready to watch",
  );
  expect(titled({ kind: "media_upgraded", media: numbered })).toBe(
    "A better version of episode 4 of The Bear arrived",
  );
  // A season likewise.
  const season = { ...episode, id: "season-2", kind: "season" } as const;
  expect(titled({ media: { ...season, title: "Season 2" } })).toBe(
    "Season 2 of The Bear is ready to watch",
  );
  expect(
    titled({
      kind: "subtitles_ready",
      media: { ...season, title: "Specials" },
    }),
  ).toBe("Subtitles for the season “Specials” of The Bear are ready");
  // No title: a plain sentence, and never a count of how many.
  expect(titled({ media: null, mediaId: null })).toBe(
    "Something new is ready to watch",
  );
  expect(titled({ kind: "files_purged", media: null })).toBe(
    "A title was removed for good",
  );
  expect(titled({ kind: "owner_health", media: null, mediaId: null })).toBe(
    "Media paused its automation",
  );
  expect(
    titled({ kind: "email_verification", media: null, mediaId: null }),
  ).toBe("Confirm your email address");
});

test("each delivery says how it ended up, and whether it needs its reader", () => {
  const about = event("e");
  const outcome = (
    channel: string,
    overrides: Partial<Omit<Delivery, "event" | "channel">>,
  ) => {
    const delivery = row(about, channel, overrides);
    return [deliveryOutcome(delivery), needsAttention(delivery)];
  };
  expect(outcome("in_app", { state: "pending" })).toEqual(["unread", false]);
  expect(outcome("in_app", { providerStatus: "viewed" })).toEqual([
    "read",
    false,
  ]);
  expect(outcome("email", { state: "pending" })).toEqual(["waiting", false]);
  expect(outcome("email", { state: "sending" })).toEqual(["sending", true]);
  expect(outcome("email", {})).toEqual(["sent", false]);
  expect(outcome("email", { providerStatus: "sent" })).toEqual(["sent", false]);
  expect(outcome("email", { providerStatus: "delivered" })).toEqual([
    "delivered",
    false,
  ]);
  // The provider took it and then reported a bounce.
  expect(outcome("email", { providerStatus: "bounced" })).toEqual([
    "bounced",
    true,
  ]);
  expect(
    outcome("email", { state: "failed", failureReason: "provider_rejected" }),
  ).toEqual(["failed", true]);
  expect(outcome("discord", { state: "unknown" })).toEqual([
    "unconfirmed",
    true,
  ]);
  expect(outcome("discord_shared", {})).toEqual(["sent", false]);
});

test("only an answer that is exactly full can be hiding older notifications", () => {
  const about = event("e");
  const rows = (count: number) =>
    Array.from({ length: count }, () => row(about, "email"));
  expect(DELIVERY_CAP).toBe(100);
  expect(isCutOff(rows(99))).toBe(false);
  expect(isCutOff(rows(100))).toBe(true);
  expect(isCutOff([])).toBe(false);
});

test("a kind, channel or state this client does not know fails instead of being guessed", () => {
  expect(() =>
    groupNotifications([row(event("e", { kind: "brand_new" }), "email")]),
  ).toThrow('Unknown notification kind "brand_new"');
  expect(() => groupNotifications([row(event("e"), "carrier_pigeon")])).toThrow(
    'Unknown notification channel "carrier_pigeon"',
  );
  expect(() =>
    deliveryOutcome(row(event("e"), "email", { state: "lost" })),
  ).toThrow('Unknown delivery state "lost"');
});
