import { describe, expect, test } from "vitest";
import {
  CiObjectStoreHttpError,
  withCiObjectStoreRetry,
} from "./ci-object-store-retry.ts";

describe("CI object-store retry boundary", () => {
  test("caps persistent connection failures at three attempts", async () => {
    const failure = Object.assign(new Error("connection failed"), {
      code: "ConnectionRefused",
    });
    let attempts = 0;
    const delays: number[] = [];
    await expect(
      withCiObjectStoreRetry(
        () => {
          attempts++;
          return Promise.reject(failure);
        },
        (milliseconds) => {
          delays.push(milliseconds);
          return Promise.resolve();
        },
      ),
    ).rejects.toBe(failure);
    expect(attempts).toBe(3);
    expect(delays).toEqual([1000, 2000]);
  });

  test.each([403, 404, 422])(
    "fails HTTP %s immediately even when its message resembles a transient error",
    async (status) => {
      const failure = new CiObjectStoreHttpError("Gateway Timeout", status);
      let attempts = 0;
      await expect(
        withCiObjectStoreRetry(() => {
          attempts++;
          return Promise.reject(failure);
        }),
      ).rejects.toBe(failure);
      expect(attempts).toBe(1);
    },
  );

  test("does not retry invalid artifact data", async () => {
    const failure = new Error("invalid archive payload");
    let attempts = 0;
    await expect(
      withCiObjectStoreRetry(() => {
        attempts++;
        return Promise.reject(failure);
      }),
    ).rejects.toBe(failure);
    expect(attempts).toBe(1);
  });
});
