import { describe, expect, test } from "bun:test";

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
      tipsOff: true,
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
