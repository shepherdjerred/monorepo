import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, commandKey, parseResponse, writeApi } from "./api.ts";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser command identity", () => {
  it("keeps a command identity through retries but separates users and generations", async () => {
    const storage = memoryStorage();
    const first = await commandKey(storage, "user", "/media/film/actions", {
      action: "keep",
      expectedVersion: 1,
    });
    expect(
      await commandKey(storage, "user", "/media/film/actions", {
        action: "keep",
        expectedVersion: 1,
      }),
    ).toEqual(first);
    const other = await commandKey(storage, "other", "/media/film/actions", {
      action: "keep",
      expectedVersion: 1,
    });
    const changed = await commandKey(storage, "user", "/media/film/actions", {
      action: "keep",
      expectedVersion: 2,
    });
    expect(other.key).not.toBe(first.key);
    expect(changed.key).not.toBe(first.key);
  });
  it("retries a lost response with the same idempotency key then retires it after success", async () => {
    vi.stubGlobal("sessionStorage", memoryStorage());
    vi.stubGlobal("document", { cookie: "media-csrf=fixture-csrf" });
    const keys: string[] = [];
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, input: RequestInit) => {
        const headers = new Headers(input.headers);
        keys.push(headers.get("Idempotency-Key") ?? "");
        expect(headers.get("X-CSRF-Token")).toBe("fixture-csrf");
        calls += 1;
        return calls === 1
          ? Promise.reject(new TypeError("Connection lost after commit"))
          : Promise.resolve(Response.json({ status: "queued" }));
      }),
    );
    const input = {
      actorId: "user",
      path: "/requests",
      body: { mediaId: "film" },
      schema: z.object({ status: z.literal("queued") }),
    };
    await expect(writeApi(input)).rejects.toThrow("Connection lost");
    await expect(writeApi(input)).resolves.toEqual({ status: "queued" });
    await expect(writeApi(input)).resolves.toEqual({ status: "queued" });
    expect(keys[0]).toBe(keys[1]);
    expect(keys[1]).not.toBe(keys[2]);
  });
  it("surfaces typed conflicts and rejects malformed successful replies", async () => {
    await expect(
      parseResponse(
        Response.json(
          {
            error: {
              code: "version_conflict",
              message: "Refresh before changing this title",
            },
          },
          { status: 409 },
        ),
        z.object({ id: z.string() }),
      ),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      parseResponse(Response.json({ id: 123 }), z.object({ id: z.string() })),
    ).rejects.toThrow();
  });
});
