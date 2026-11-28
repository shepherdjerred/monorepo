import { describe, expect, it } from "vitest";
import { createTokenCache } from "./token-cache.ts";

const version = (id: string) => ({
  versionId: id,
  artifactId: "artifact",
  kind: "html",
  entryPath: "index.html",
});

describe("token cache", () => {
  it("serves a token for 60 seconds, then forgets it", () => {
    let now = 1000;
    const cache = createTokenCache(() => now);
    cache.set("a", version("v1"));
    now += 59_999;
    expect(cache.get("a")?.versionId).toBe("v1");
    now += 2;
    expect(cache.get("a")).toBeUndefined();
  });

  it("evicts a rotated token and every token of a purged version at once", () => {
    const cache = createTokenCache(() => 0);
    cache.set("old", version("v1"));
    cache.set("other", version("v2"));
    cache.invalidateToken("old");
    expect(cache.get("old")).toBeUndefined();
    expect(cache.get("other")).toBeDefined();
    cache.set("again", version("v2"));
    cache.invalidateVersion("v2");
    expect(cache.size()).toBe(0);
  });

  it("is bounded: the least recently used entry goes first", () => {
    const cache = createTokenCache(() => 0);
    for (let index = 0; index < 512; index += 1)
      cache.set(`t${String(index)}`, version("v"));
    expect(cache.get("t0")).toBeDefined();
    cache.set("overflow", version("v"));
    expect(cache.size()).toBe(512);
    expect(cache.get("t1")).toBeUndefined();
    expect(cache.get("t0")).toBeDefined();
  });
});
