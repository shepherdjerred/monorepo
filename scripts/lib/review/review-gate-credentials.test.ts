import { afterEach, describe, expect, test, vi } from "vitest";
import {
  installationTokenSource,
  READ_TOKEN_REFRESH_MARGIN_MS,
  reviewGateCredentials,
} from "./review-gate-credentials.ts";

afterEach(() => vi.restoreAllMocks());

const HOUR_MS = 60 * 60 * 1000;

function environment(): Record<string, string | undefined> {
  return {
    GITHUB_APP_ID: "123",
    GITHUB_APP_INSTALLATION_ID: "456",
    GITHUB_APP_PRIVATE_KEY: "pem",
    GITHUB_REVIEW_TOKEN: "owner-review-token",
  };
}

/** A source on a controllable clock whose Nth mint returns `token-N`. */
function clockedSource() {
  vi.spyOn(console, "log").mockImplementation(vi.fn());
  const clock = { now: 0 };
  const mint = vi.fn(async () => ({
    token: `token-${String(mint.mock.calls.length)}`,
    expiresAt: new Date(clock.now + HOUR_MS),
  }));
  const read = installationTokenSource({
    installationId: "456",
    mint,
    now: () => clock.now,
  });
  return { clock, mint, read };
}

describe("installationTokenSource", () => {
  test("mints once and reuses the token while it is fresh", async () => {
    const { clock, mint, read } = clockedSource();

    expect(await read()).toBe("token-1");
    clock.now = HOUR_MS - READ_TOKEN_REFRESH_MARGIN_MS - 1;
    expect(await read()).toBe("token-1");
    expect(mint).toHaveBeenCalledTimes(1);
  });

  test("mints a new token before the held one expires", async () => {
    const { clock, mint, read } = clockedSource();

    await read();
    clock.now = HOUR_MS - READ_TOKEN_REFRESH_MARGIN_MS;
    expect(await read()).toBe("token-2");
    expect(mint).toHaveBeenCalledTimes(2);
  });

  test("logs the identity and expiry but never the token", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(vi.fn());
    const read = installationTokenSource({
      installationId: "456",
      mint: async () => ({
        token: "ghs_secret",
        expiresAt: new Date("2026-11-12T01:00:00Z"),
      }),
      now: () => Date.parse("2026-11-12T00:00:00Z"),
    });

    await read();
    const logged = log.mock.calls.flat().join("\n");
    expect(logged).toContain("GitHub App installation 456");
    expect(logged).toContain("2026-11-12T01:00:00.000Z");
    expect(logged).not.toContain("ghs_secret");
  });

  test("a failed mint propagates and is retried on the next read", async () => {
    vi.spyOn(console, "log").mockImplementation(vi.fn());
    const mint = vi
      .fn<() => Promise<{ token: string; expiresAt: Date }>>()
      .mockRejectedValueOnce(new Error("request failed with 503"))
      .mockResolvedValueOnce({
        token: "token",
        expiresAt: new Date(Date.now() + HOUR_MS),
      });
    const read = installationTokenSource({ installationId: "456", mint });

    await expect(read()).rejects.toThrow(/503/u);
    expect(await read()).toBe("token");
  });
});

describe("reviewGateCredentials", () => {
  test("reads as the App and posts review requests with the review token", async () => {
    vi.spyOn(console, "log").mockImplementation(vi.fn());
    const mint = vi.fn(async () => ({
      token: "installation-token",
      expiresAt: new Date(Date.now() + HOUR_MS),
    }));
    const credentials = reviewGateCredentials(environment(), mint);

    expect(credentials.requestToken).toBe("owner-review-token");
    expect(await credentials.readToken()).toBe("installation-token");
    expect(mint).toHaveBeenCalledWith({
      GITHUB_APP_ID: "123",
      GITHUB_APP_INSTALLATION_ID: "456",
      GITHUB_APP_PRIVATE_KEY: "pem",
    });
  });

  test("never falls back to the review token for reads", () => {
    for (const name of [
      "GITHUB_APP_ID",
      "GITHUB_APP_INSTALLATION_ID",
      "GITHUB_APP_PRIVATE_KEY",
      "GITHUB_REVIEW_TOKEN",
    ]) {
      const env = environment();
      env[name] = undefined;
      expect(() => reviewGateCredentials(env, vi.fn())).toThrow(name);
    }
  });
});
