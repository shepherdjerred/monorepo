import { expect, test } from "vitest";
import { BootstrapSchema } from "./config.ts";

test("TRMNL capability rejects partial credentials and accepts only the complete bootstrap tuple", () => {
  const base = { DATABASE_URL: "postgresql://localhost/delivery" };
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
