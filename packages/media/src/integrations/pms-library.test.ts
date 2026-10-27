import { afterAll, expect, test } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createPmsWire } from "#e2e/pms/http.ts";
import { createLibraries } from "#e2e/pms/assertions.ts";

const directory = await mkdtemp(path.join(os.tmpdir(), "media-pms-library-"));
afterAll(() => rm(directory, { recursive: true, force: true }));

async function fixture(status = 201) {
  const root = path.join(directory, crypto.randomUUID());
  await mkdir(path.join(root, "artifacts"), { recursive: true });
  const sections: {
    key: string;
    type: "movie" | "show";
    title: string;
    agent: string;
    scanner: string;
    refreshing: boolean;
    Location: { path: string }[];
  }[] = [];
  const requests: { method: string; path: string }[] = [];
  const wire = createPmsWire(root, AbortSignal.timeout(2000), (url, init) => {
    const method = init.method ?? "GET";
    requests.push({ method, path: url.pathname });
    expect(url.origin).toBe("http://127.0.0.1:32400");
    expect(new Headers(init.headers).has("X-Plex-Pms-Api-Version")).toBe(false);
    if (url.pathname === "/media/providers/metadata")
      return Promise.resolve(
        Response.json({
          MediaContainer: {
            MetadataAgentProvider: [
              { identifier: "tv.plex.agents.movie" },
              { identifier: "tv.plex.agents.series" },
            ],
          },
        }),
      );
    expect(url.pathname).toBe("/library/sections");
    if (method === "POST") {
      if (status !== 201)
        return Promise.resolve(
          new Response("Synthetic rejected creation", { status }),
        );
      const type = url.searchParams.get("type");
      if (type !== "movie" && type !== "show")
        throw new Error("Creation requires the library kind");
      expect(url.searchParams.get("location")).toBe(
        path.join(root, "media", type),
      );
      expect(url.searchParams.has("locations")).toBe(false);
      sections.push({
        key: String(sections.length + 1),
        type,
        title: `Synthetic ${type}`,
        agent:
          type === "movie" ? "tv.plex.agents.movie" : "tv.plex.agents.series",
        scanner: type === "movie" ? "Plex Movie" : "Plex TV Series",
        refreshing: false,
        Location: [{ path: path.join(root, "media", type) }],
      });
      return Promise.resolve(
        Response.json({ MediaContainer: { size: 0 } }, { status: 201 }),
      );
    }
    expect(method).toBe("GET");
    return Promise.resolve(
      Response.json({ MediaContainer: { Directory: sections } }),
    );
  });
  return { root, wire, requests };
}

test("native fixture creates the two libraries through the established PMS creation contract", async () => {
  const f = await fixture();
  const sections = await createLibraries(f.wire, { root: f.root });
  expect(sections.map((section) => section.type)).toEqual(["movie", "show"]);
  expect(f.requests).toEqual([
    { method: "GET", path: "/media/providers/metadata" },
    { method: "POST", path: "/library/sections" },
    { method: "POST", path: "/library/sections" },
    { method: "GET", path: "/library/sections" },
  ]);
});

test.each([200, 400, 404])(
  "native creation HTTP %s is terminal without retrying or switching endpoints",
  async (status) => {
    const f = await fixture(status);
    await expect(createLibraries(f.wire, { root: f.root })).rejects.toThrow(
      `HTTP ${String(status)}`,
    );
    expect(f.requests.filter((request) => request.method === "POST")).toEqual([
      { method: "POST", path: "/library/sections" },
    ]);
  },
);
