import { expect, test } from "vitest";
import { BootstrapSchema } from "./config.ts";

const DATABASE_URL = "postgresql://localhost/delivery";
function credentials(...entries: { id: string; scopes: string[] }[]) {
  return JSON.stringify(
    entries.map(({ id, scopes }, index) => ({
      token: String(index).repeat(32),
      principal: { id, kind: "machine", scopes },
    })),
  );
}

function parse(value: string) {
  return BootstrapSchema.safeParse({
    DATABASE_URL,
    DELIVERY_MACHINE_CREDENTIALS: value,
  }).success;
}

test("an attestor identity holds one credential that only reads and attests (X13)", () => {
  expect(
    parse(
      credentials(
        { id: "delivery-executor", scopes: ["read", "execute"] },
        { id: "delivery-operator-attestor", scopes: ["read", "attest"] },
      ),
    ),
  ).toBe(true);
  // The same principal cannot attest under one token and execute under another.
  expect(
    parse(
      credentials(
        { id: "operator", scopes: ["read", "attest"] },
        { id: "operator", scopes: ["read", "execute"] },
      ),
    ),
  ).toBe(false);
  // Nor can one attestation credential deploy, publish or administer.
  for (const scope of ["deploy", "publish", "admin", "execute"])
    expect(
      parse(credentials({ id: "operator", scopes: ["read", "attest", scope] })),
    ).toBe(false);
});

test("TRMNL capability rejects partial credentials and accepts only the complete bootstrap tuple", () => {
  const base = { DATABASE_URL };
  expect(BootstrapSchema.safeParse(base).success).toBe(true);
  expect(
    BootstrapSchema.safeParse({ ...base, TRMNL_API_KEY: "synthetic" }).success,
  ).toBe(false);
  expect(
    BootstrapSchema.safeParse({
      ...base,
      DELIVERY_TRMNL_S3_ACCESS_KEY_ID: "synthetic",
      DELIVERY_TRMNL_S3_SECRET_ACCESS_KEY: "synthetic",
    }).success,
  ).toBe(false);
  expect(
    BootstrapSchema.safeParse({
      ...base,
      TRMNL_API_KEY: "synthetic",
      DELIVERY_TRMNL_S3_ACCESS_KEY_ID: "synthetic",
      DELIVERY_TRMNL_S3_SECRET_ACCESS_KEY: "synthetic",
    }).success,
  ).toBe(true);
});
