import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  ApiError,
  commandKey,
  parseResponse,
  readApi,
  writeApi,
} from "./api.ts";

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

async function assertV4CommandIdentity(
  input: Parameters<typeof writeApi>[0],
  calls: { url: string; key: string | null }[],
) {
  await expect(writeApi({ ...input, version: 4 })).rejects.toThrow(
    "Unacknowledged",
  );
  await expect(writeApi({ ...input, version: 4 })).rejects.toThrow(
    "Unacknowledged",
  );
  expect(calls[6]?.url).toBe("/api/v4/media/film/commands");
  expect(calls[6]?.key).not.toBe(calls[0]?.key);
  expect(calls[6]?.key).not.toBe(calls[1]?.key);
  expect(calls[6]?.key).not.toBe(calls[4]?.key);
  expect(calls[6]?.key).toBe(calls[7]?.key);
  await expect(
    readApi("/media/film/movie-editions/extended_cut", input.schema, 4),
  ).resolves.toEqual({ status: "ready" });
  expect(calls[8]?.url).toBe("/api/v4/media/film/movie-editions/extended_cut");
  expect(calls[8]?.key).toBeNull();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser command identity", () => {
  it("keeps each supported protocol's outstanding command and retry identity distinct", async () => {
    vi.stubGlobal("sessionStorage", memoryStorage());
    vi.stubGlobal("document", { cookie: "media-csrf=fixture" });
    const calls: { url: string; key: string | null }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init: RequestInit) => {
        calls.push({
          url,
          key: new Headers(init.headers).get("Idempotency-Key"),
        });
        return init.method === undefined
          ? Promise.resolve(Response.json({ status: "ready" }))
          : Promise.reject(new TypeError("Unacknowledged command"));
      }),
    );
    const input = {
      actorId: "user",
      path: "/media/film/commands",
      body: { action: "keep" },
      schema: z.object({ status: z.string() }),
    };
    await expect(writeApi(input)).rejects.toThrow("Unacknowledged");
    await expect(writeApi({ ...input, version: 2 })).rejects.toThrow(
      "Unacknowledged",
    );
    await expect(writeApi({ ...input, version: 2 })).rejects.toThrow(
      "Unacknowledged",
    );
    expect(calls[0]?.url).toBe("/api/v1/media/film/commands");
    expect(calls[1]?.url).toBe("/api/v2/media/film/commands");
    expect(calls[0]?.key).not.toBe(calls[1]?.key);
    expect(calls[1]?.key).toBe(calls[2]?.key);
    await expect(
      readApi("/media/film/targets/default", input.schema, 2),
    ).resolves.toEqual({ status: "ready" });
    expect(calls[3]?.url).toBe("/api/v2/media/film/targets/default");
    expect(calls[3]?.key).toBeNull();
    await expect(writeApi({ ...input, version: 3 })).rejects.toThrow(
      "Unacknowledged",
    );
    await expect(writeApi({ ...input, version: 3 })).rejects.toThrow(
      "Unacknowledged",
    );
    expect(calls[4]?.url).toBe("/api/v3/media/film/commands");
    expect(calls[4]?.key).not.toBe(calls[0]?.key);
    expect(calls[4]?.key).not.toBe(calls[1]?.key);
    expect(calls[4]?.key).toBe(calls[5]?.key);
    await assertV4CommandIdentity(input, calls);
  });
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
