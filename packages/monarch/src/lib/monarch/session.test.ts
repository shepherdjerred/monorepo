import { describe, expect, test } from "bun:test";
import { buildCookieHeader, findCsrfToken } from "./session.ts";
import type { MonarchSession } from "./session.ts";

describe("buildCookieHeader", () => {
  test("includes session cookies and filters expired cookies", () => {
    const nowMs = new Date("2026-05-17T12:00:00.000Z").getTime();
    expect(
      buildCookieHeader(
        [
          makeCookie("sessionid", "abc", -1),
          makeCookie("csrftoken", "csrf", nowMs / 1000 + 60),
          makeCookie("expired", "old", nowMs / 1000 - 60),
        ],
        nowMs,
      ),
    ).toBe("sessionid=abc; csrftoken=csrf");
  });
});

describe("findCsrfToken", () => {
  test("prefers captured request header", () => {
    expect(
      findCsrfToken({
        createdAt: "2026-05-17T12:00:00.000Z",
        cookies: [makeCookie("csrftoken", "cookie-csrf", -1)],
        headers: { "x-csrftoken": "header-csrf" },
      }),
    ).toBe("header-csrf");
  });

  test("falls back to csrftoken cookie", () => {
    expect(
      findCsrfToken({
        createdAt: "2026-05-17T12:00:00.000Z",
        cookies: [makeCookie("csrftoken", "cookie-csrf", -1)],
        headers: {},
      }),
    ).toBe("cookie-csrf");
  });
});

function makeCookie(
  name: string,
  value: string,
  expires: number,
): MonarchSession["cookies"][number] {
  return {
    name,
    value,
    domain: ".monarch.com",
    path: "/",
    expires,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  };
}
