import { describe, expect, test } from "vitest";
import {
  CiObjectStoreHttpError,
  withCiObjectStoreRetry,
} from "./ci-object-store-retry.ts";

describe("CI object-store retry boundary", () => {
  test("recovers from DNS lookup failures on the last attempt", async () => {
    const failure = Object.assign(new TypeError("getaddrinfo ENOTFOUND"), {
      code: "ENOTFOUND",
    });
    let attempts = 0;
    const delays: number[] = [];
    await expect(
      withCiObjectStoreRetry(
        () => {
          attempts++;
          return attempts < 5
            ? Promise.reject(failure)
            : Promise.resolve("uploaded");
        },
        (milliseconds) => {
          delays.push(milliseconds);
          return Promise.resolve();
        },
      ),
    ).resolves.toBe("uploaded");
    expect(attempts).toBe(5);
    expect(delays).toEqual([1000, 2000, 4000, 8000]);
  });

  test("caps persistent connection failures at five attempts and throws the last error", async () => {
    const firstFailure = Object.assign(new Error("connection failed"), {
      code: "ConnectionRefused",
    });
    const lastFailure = Object.assign(new Error("connection still failed"), {
      code: "ConnectionRefused",
    });
    let attempts = 0;
    const delays: number[] = [];
    await expect(
      withCiObjectStoreRetry(
        () => {
          attempts++;
          return Promise.reject(attempts < 5 ? firstFailure : lastFailure);
        },
        (milliseconds) => {
          delays.push(milliseconds);
          return Promise.resolve();
        },
      ),
    ).rejects.toBe(lastFailure);
    expect(attempts).toBe(5);
    expect(delays).toEqual([1000, 2000, 4000, 8000]);
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
