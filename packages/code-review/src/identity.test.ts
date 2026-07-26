import { describe, expect, test } from "bun:test";
import { isProviderAuthor, normalizeLogin } from "./identity.ts";
import { codexProvider } from "./providers/codex.ts";
import { greptileProvider } from "./providers/greptile.ts";

describe("normalizeLogin", () => {
  test("strips a trailing [bot] suffix", () => {
    expect(normalizeLogin("chatgpt-codex-connector[bot]")).toBe(
      "chatgpt-codex-connector",
    );
    expect(normalizeLogin("greptile-apps")).toBe("greptile-apps");
  });

  test("passes null through", () => {
    expect(normalizeLogin(null)).toBeNull();
  });
});

describe("isProviderAuthor", () => {
  test("matches the exact GraphQL slug and the [bot] REST form", () => {
    expect(isProviderAuthor(codexProvider, "chatgpt-codex-connector")).toBe(
      true,
    );
    expect(
      isProviderAuthor(codexProvider, "chatgpt-codex-connector[bot]"),
    ).toBe(true);
    expect(isProviderAuthor(greptileProvider, "greptile-apps")).toBe(true);
    expect(isProviderAuthor(greptileProvider, "greptile-apps[bot]")).toBe(true);
  });

  test("is case-insensitive", () => {
    expect(isProviderAuthor(codexProvider, "ChatGPT-Codex-Connector")).toBe(
      true,
    );
  });

  test("rejects a look-alike login that merely CONTAINS the slug", () => {
    // The whole point of the exact-match fix: a substring match would let any
    // of these impersonate the provider and satisfy the blocking gate.
    expect(
      isProviderAuthor(codexProvider, "chatgpt-codex-connector-evil"),
    ).toBe(false);
    expect(
      isProviderAuthor(codexProvider, "evil-chatgpt-codex-connector"),
    ).toBe(false);
    expect(
      isProviderAuthor(codexProvider, "chatgpt-codex-connector-org/hack"),
    ).toBe(false);
    expect(isProviderAuthor(greptileProvider, "greptile-apps-fake")).toBe(
      false,
    );
  });

  test("rejects a different provider's login and empty/nullish logins", () => {
    const missing: string | undefined = undefined;
    expect(isProviderAuthor(codexProvider, "greptile-apps")).toBe(false);
    expect(isProviderAuthor(codexProvider, null)).toBe(false);
    expect(isProviderAuthor(codexProvider, missing)).toBe(false);
    expect(isProviderAuthor(codexProvider, "")).toBe(false);
  });
});
