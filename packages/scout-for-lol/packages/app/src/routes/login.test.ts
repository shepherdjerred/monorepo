import { describe, expect, test } from "vitest";
import { LOGIN_DESCRIPTION } from "#src/routes/login.tsx";

describe("login copy", () => {
  test("describes member and management access without an administrator aside", () => {
    expect(LOGIN_DESCRIPTION).toBe(
      "Sign in with Discord to ask Scout, find players in shared servers, or manage servers where you have access.",
    );
    expect(LOGIN_DESCRIPTION).not.toContain(
      "You do not need to be an administrator",
    );
  });
});
