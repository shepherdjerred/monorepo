import { describe, expect, it } from "bun:test";
import { createPrivateKey } from "node:crypto";
import {
  createGitHubAppInstallationToken,
  createGitHubAppJwt,
  normalizePrivateKey,
  type FetchLike,
  type GitHubAppEnv,
} from "./github-app-token.ts";

type FetchCall = {
  readonly input: string;
  readonly init: RequestInit;
};

function base64UrlDecode(value: string): string {
  const padded = value.padEnd(
    value.length + ((4 - (value.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    const code = binary.codePointAt(i);
    if (code === undefined) {
      throw new Error("invalid base64url byte");
    }
    bytes[i] = code;
  }
  return new TextDecoder().decode(bytes);
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("decoded JWT parts must be objects");
  }
  return Object.fromEntries(Object.entries(value));
}

async function testPrivateKeyPem(): Promise<string> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const encoded = btoa(String.fromCodePoint(...new Uint8Array(pkcs8)));
  const lines = encoded.match(/.{1,64}/g) ?? [];
  return [
    "-----BEGIN PRIVATE KEY-----",
    ...lines,
    "-----END PRIVATE KEY-----",
    "",
  ].join("\n");
}

async function testPrivateKeyPemPkcs1(): Promise<string> {
  const pkcs8Pem = await testPrivateKeyPem();
  return createPrivateKey({ key: pkcs8Pem, format: "pem" }).export({
    type: "pkcs1",
    format: "pem",
  });
}

function makeEnv(privateKey: string): GitHubAppEnv {
  return {
    GITHUB_APP_ID: "12345",
    GITHUB_APP_INSTALLATION_ID: "67890",
    GITHUB_APP_PRIVATE_KEY: privateKey,
  };
}

describe("github-app-token", () => {
  it("requires app id, installation id, and private key", async () => {
    await expect(createGitHubAppInstallationToken({ env: {} })).rejects.toThrow(
      "GITHUB_APP_ID is required",
    );
  });

  it("normalizes escaped PEM newlines", async () => {
    const pem = await testPrivateKeyPem();
    expect(normalizePrivateKey(pem.replaceAll("\n", String.raw`\n`))).toBe(pem);
  });

  it("accepts a PKCS#1 RSA PEM (GitHub's default download format)", async () => {
    const pem = await testPrivateKeyPemPkcs1();
    expect(pem).toContain("BEGIN RSA PRIVATE KEY");
    const jwt = await createGitHubAppJwt({
      appId: "12345",
      privateKey: pem,
      now: () => 1_800_000_000_000,
    });
    expect(jwt.split(".")).toHaveLength(3);
  });

  it("creates a RS256 JWT with app id and bounded expiry", async () => {
    const pem = await testPrivateKeyPem();
    const now = 1_800_000_000_000;
    const jwt = await createGitHubAppJwt({
      appId: "12345",
      privateKey: pem,
      now: () => now,
    });
    const parts = jwt.split(".");
    expect(parts).toHaveLength(3);

    const header = requireRecord(JSON.parse(base64UrlDecode(parts[0] ?? "")));
    const payload = requireRecord(JSON.parse(base64UrlDecode(parts[1] ?? "")));
    expect(header["alg"]).toBe("RS256");
    expect(header["typ"]).toBe("JWT");
    expect(payload["iss"]).toBe("12345");
    expect(payload["iat"]).toBe(1_799_999_940);
    expect(payload["exp"]).toBe(1_800_000_480);
  });

  it("posts a JWT to the installation access token endpoint", async () => {
    const pem = await testPrivateKeyPem();
    const calls: FetchCall[] = [];
    const fetchFn: FetchLike = async (input, init) => {
      calls.push({ input, init });
      return Response.json(
        {
          token: "installation-token",
          expires_at: "2030-01-01T00:00:00Z",
        },
        { status: 201 },
      );
    };

    const result = await createGitHubAppInstallationToken({
      env: makeEnv(pem.replaceAll("\n", String.raw`\n`)),
      fetch: fetchFn,
      now: () => 1_800_000_000_000,
    });

    expect(result.token).toBe("installation-token");
    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (call === undefined) {
      throw new Error("expected one fetch call");
    }
    expect(call.input).toBe(
      "https://api.github.com/app/installations/67890/access_tokens",
    );
    const headers = new Headers(call.init.headers);
    expect(headers.get("Authorization")?.startsWith("Bearer ")).toBe(true);
    expect(headers.get("Accept")).toBe("application/vnd.github+json");
    expect(call.init.method).toBe("POST");
  });

  it("rejects token responses without a token", async () => {
    const pem = await testPrivateKeyPem();
    await expect(
      createGitHubAppInstallationToken({
        env: makeEnv(pem),
        fetch: async () =>
          Response.json({ expires_at: "2030-01-01T00:00:00Z" }),
        now: () => 1_800_000_000_000,
      }),
    ).rejects.toThrow("did not include a token");
  });

  it("rejects expired installation tokens", async () => {
    const pem = await testPrivateKeyPem();
    await expect(
      createGitHubAppInstallationToken({
        env: makeEnv(pem),
        fetch: async () =>
          Response.json({
            token: "expired",
            expires_at: "2020-01-01T00:00:00Z",
          }),
        now: () => 1_800_000_000_000,
      }),
    ).rejects.toThrow("already expired");
  });
});
