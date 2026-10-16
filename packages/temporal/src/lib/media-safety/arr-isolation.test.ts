import { expect, test, vi } from "vitest";
import { reconcileIndexerSafety } from "./arr.ts";
import { MediaApi, type MediaRequest } from "./client.ts";

test("a stalled indexer save does not prevent another indexer from being protected", async () => {
  const stalled = Promise.withResolvers<Response>();
  const configured = new Map([
    [1, [0]],
    [2, [0]],
  ]);
  const indexer = (id: number) => ({
    id,
    fields: [{ name: "failDownloads", value: configured.get(id) }],
  });
  const request: MediaRequest = (input, init) => {
    const path = new URL(input).pathname;
    if (path === "/indexer")
      return Promise.resolve(Response.json([indexer(1), indexer(2)]));
    const id = Number(path.split("/").at(-1));
    if (!configured.has(id)) throw new Error("Unknown fixture indexer");
    if (init?.method === "PUT") {
      if (id === 1) return stalled.promise;
      configured.set(id, [0, 1]);
    }
    return Promise.resolve(Response.json(indexer(id)));
  };
  const failure = expect(
    reconcileIndexerSafety(new MediaApi("https://fixture", {}, request), true),
  ).rejects.toThrow("Indexer 1");
  try {
    await vi.waitFor(() => expect(configured.get(2)).toEqual([0, 1]));
  } finally {
    stalled.reject(new Error("Indexer validation timed out"));
    await failure;
  }
});
