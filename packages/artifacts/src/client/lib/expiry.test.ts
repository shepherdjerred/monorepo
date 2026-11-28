import { describe, expect, test } from "vitest";
import { expiryNote } from "./expiry.ts";

const DAY = 86_400_000;
const now = Date.parse("2026-11-26T12:00:00Z");
const base = {
  keep: false,
  lastActivityAt: new Date(now).toISOString(),
  archivedAt: null,
  expiredAt: null,
  expiresAt: null,
} as const;

describe("expiryNote", () => {
  test("is 90 days after the last activity", () => {
    expect(expiryNote(base, now)).toEqual({
      text: "Expires in 90 days",
      amber: false,
    });
  });

  test("turns amber under 14 days", () => {
    const idle = new Date(now - 77 * DAY).toISOString();
    expect(expiryNote({ ...base, lastActivityAt: idle }, now)).toEqual({
      text: "Expires in 13 days",
      amber: true,
    });
    const fourteen = new Date(now - 76 * DAY).toISOString();
    expect(expiryNote({ ...base, lastActivityAt: fourteen }, now)?.amber).toBe(
      false,
    );
  });

  test("says today on the last day and singular for one day", () => {
    const today = new Date(now - 90 * DAY).toISOString();
    expect(expiryNote({ ...base, lastActivityAt: today }, now)?.text).toBe(
      "Expires today",
    );
    const tomorrow = new Date(now - 89 * DAY).toISOString();
    expect(expiryNote({ ...base, lastActivityAt: tomorrow }, now)?.text).toBe(
      "Expires in 1 day",
    );
  });

  test("a kept board has no expiry", () => {
    expect(expiryNote({ ...base, keep: true }, now)).toBeNull();
  });

  test("an archived board counts 7 days from archiving", () => {
    const archivedAt = new Date(now - 2 * DAY).toISOString();
    expect(expiryNote({ ...base, archivedAt }, now)).toEqual({
      text: "Expires in 5 days",
      amber: true,
    });
  });

  test("the server's expiresAt wins", () => {
    const expiresAt = new Date(now + 30 * DAY).toISOString();
    expect(expiryNote({ ...base, expiresAt }, now)?.text).toBe(
      "Expires in 30 days",
    );
  });

  test("a purged board says its files are gone", () => {
    expect(
      expiryNote({ ...base, expiredAt: new Date(now).toISOString() }, now),
    ).toEqual({
      text: "Files deleted",
      amber: true,
    });
  });
});
