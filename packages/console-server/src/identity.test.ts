import { describe, expect, it } from "vitest";
import {
  IdentityRejectedError,
  machineToken,
  parseTrustedProxies,
  resolveIdentity,
  tailscaleIdentity,
} from "./identity.ts";

const LOGIN = { "tailscale-user-login": "jerred@sjer.red" };

function request(
  headers: Record<string, string> = {},
  method = "GET",
): Request {
  return new Request("http://console.test/x", { method, headers });
}

async function rejection(promise: Promise<unknown>): Promise<{
  status: number;
  message: string;
}> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof IdentityRejectedError) {
      return { status: error.status, message: error.message };
    }
    throw error;
  }
  throw new Error("expected a rejection");
}

describe("parseTrustedProxies", () => {
  it("matches exact addresses, subnets and IPv4-mapped IPv6 peers", () => {
    const list = parseTrustedProxies(["10.42.0.0/16", "::1", "192.168.1.5"]);
    expect(list.check("10.42.7.9", "ipv4")).toBe(true);
    expect(list.check("10.43.0.1", "ipv4")).toBe(false);
    expect(list.check("::1", "ipv6")).toBe(true);
    expect(list.check("192.168.1.5", "ipv4")).toBe(true);
  });

  it("fails loudly on a malformed entry", () => {
    for (const entry of ["10.0.0.0/33", "nope", "10.0.0.0/8/1", "::/x"]) {
      expect(() => parseTrustedProxies([entry])).toThrow(
        `Invalid trusted proxy entry: ${entry}`,
      );
    }
  });
});

describe("tailscaleIdentity", () => {
  const optional = tailscaleIdentity({ trustedProxies: ["127.0.0.1"] });

  it("trusts the headers from the proxy, including a mapped loopback peer", async () => {
    await expect(
      optional({
        request: request({ ...LOGIN, "tailscale-user-name": " Jerred " }),
        peerAddress: "::ffff:127.0.0.1",
      }),
    ).resolves.toEqual({
      kind: "viewer",
      login: "jerred@sjer.red",
      displayName: "Jerred",
    });
  });

  it("ignores spoofed headers from any other peer", async () => {
    await expect(
      optional({ request: request(LOGIN), peerAddress: "10.0.0.8" }),
    ).resolves.toEqual({ kind: "anonymous" });
    await expect(
      optional({ request: request(LOGIN), peerAddress: null }),
    ).resolves.toEqual({ kind: "anonymous" });
  });

  it("rejects instead when identity is required, or the login is not an operator", async () => {
    const strict = tailscaleIdentity({
      trustedProxies: ["127.0.0.1"],
      required: true,
      operatorLogins: ["jerred@sjer.red"],
    });
    expect(
      await rejection(
        strict({ request: request(LOGIN), peerAddress: "10.0.0.8" }),
      ),
    ).toEqual({
      status: 401,
      message: "authenticated private ingress required",
    });
    expect(
      await rejection(strict({ request: request(), peerAddress: "127.0.0.1" })),
    ).toEqual({ status: 403, message: "operator identity is not authorized" });
    expect(
      await rejection(
        strict({
          request: request({ "tailscale-user-login": "mallory@example.com" }),
          peerAddress: "127.0.0.1",
        }),
      ),
    ).toEqual({ status: 403, message: "operator identity is not authorized" });
  });

  it("requires the console's own Origin on a state-changing request", async () => {
    const scheme = tailscaleIdentity({
      trustedProxies: ["127.0.0.1"],
      publicOrigin: "https://go.tailnet-1a49.ts.net/",
    });
    expect(
      await rejection(
        scheme({ request: request(LOGIN, "POST"), peerAddress: "127.0.0.1" }),
      ),
    ).toEqual({ status: 403, message: "same-origin browser request required" });
    await expect(
      scheme({
        request: request(
          { ...LOGIN, origin: "https://go.tailnet-1a49.ts.net" },
          "POST",
        ),
        peerAddress: "127.0.0.1",
      }),
    ).resolves.toMatchObject({ kind: "viewer" });
  });

  it("answers 503 when dynamic proxy verification fails", async () => {
    const scheme = tailscaleIdentity({
      trustedProxies: async () => {
        throw new Error("kubernetes unreachable");
      },
    });
    expect(
      await rejection(
        scheme({ request: request(LOGIN), peerAddress: "10.0.0.1" }),
      ),
    ).toEqual({
      status: 503,
      message: "private ingress identity verification unavailable",
    });
  });
});

describe("machineToken", () => {
  const scheme = machineToken({
    credentials: [{ id: "toolkit", token: "s3cret", scopes: ["read"] }],
  });

  it("leaves a request without Authorization to the next scheme", async () => {
    await expect(
      resolveIdentity([scheme], { request: request(), peerAddress: null }),
    ).resolves.toEqual({ kind: "anonymous" });
  });

  it("names the caller and its scopes", async () => {
    await expect(
      scheme({
        request: request({ authorization: "Bearer s3cret" }),
        peerAddress: null,
      }),
    ).resolves.toEqual({ kind: "machine", id: "toolkit", scopes: ["read"] });
  });

  it("rejects a wrong token and a non-Bearer header", async () => {
    expect(
      await rejection(
        scheme({
          request: request({ authorization: "Bearer nope" }),
          peerAddress: null,
        }),
      ),
    ).toEqual({ status: 401, message: "invalid machine credential" });
    expect(
      await rejection(
        scheme({
          request: request({ authorization: "Basic abc" }),
          peerAddress: null,
        }),
      ),
    ).toEqual({ status: 401, message: "Bearer authentication required" });
  });

  it("refuses empty and shared tokens at start-up", () => {
    expect(() =>
      machineToken({ credentials: [{ id: "a", token: "", scopes: [] }] }),
    ).toThrow("empty token");
    expect(() =>
      machineToken({
        credentials: [
          { id: "a", token: "same", scopes: [] },
          { id: "b", token: "same", scopes: [] },
        ],
      }),
    ).toThrow("reuses a token");
  });
});
