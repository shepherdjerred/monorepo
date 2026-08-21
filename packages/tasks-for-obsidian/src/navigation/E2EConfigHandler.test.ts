import { describe, expect, test } from "vitest";

import { parseE2EConfigUrl } from "./e2e-config";

describe("e2e config URL", () => {
  test("parses a flow nonce with the connection settings", () => {
    expect(
      parseE2EConfigUrl(
        "tasknotes://e2e-config?apiUrl=http%3A%2F%2F127.0.0.1%3A18902&token=secret&tips=off&nonce=03-recurring-complete",
      ),
    ).toEqual({
      apiUrl: "http://127.0.0.1:18902",
      token: "secret",
      nonce: "03-recurring-complete",
      today: null,
      tipsOff: true,
    });
  });

  test("accepts a frozen flow date", () => {
    expect(
      parseE2EConfigUrl(
        "tasknotes://e2e-config?apiUrl=http://localhost&token=secret&today=2026-08-08",
      ),
    ).toEqual({
      apiUrl: "http://localhost",
      token: "secret",
      nonce: null,
      today: "2026-08-08",
      tipsOff: false,
    });
  });

  test("rejects a nonce that cannot form a stable accessibility ID", () => {
    expect(
      parseE2EConfigUrl(
        "tasknotes://e2e-config?apiUrl=http://localhost&token=secret&nonce=../flow",
      ),
    ).toBeNull();
  });
});
