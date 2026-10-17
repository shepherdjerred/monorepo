import { describe, expect, it } from "vitest";
import path from "node:path";

const scriptPath = path.join(import.meta.dir, "hitandrun-share-limit.sh");
const attempt = "12345678-1234-1234-1234-123456789abc";
const operation = "abcdef12-1234-1234-1234-123456789abc";
const legacy = {
  hash: "a".repeat(40),
  name: "fixture",
  size: 20_000_000_000,
  ratio_limit: 3,
  category: "radarr",
  auto_tmm: false,
  tags: "",
  save_path: "/downloads/radarr",
};
const media = {
  ...legacy,
  category: "media",
  tags: `media-${operation}, media-attempt-${attempt}`,
  save_path: `/downloads/media/${attempt}`,
};

async function runHook(
  observations: (typeof legacy)[],
  target: string = legacy.hash,
) {
  let reads = 0;
  const mutations: URLSearchParams[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname.endsWith("/auth/login")) return new Response("Ok.");
      if (url.pathname.endsWith("/torrents/info")) {
        if (!url.searchParams.has("hashes")) {
          return Response.json([{ hash: legacy.hash }]);
        }
        const observation =
          observations[Math.min(reads++, observations.length - 1)];
        return Response.json(observation ? [observation] : []);
      }
      if (url.pathname.endsWith("/torrents/setShareLimits")) {
        mutations.push(new URLSearchParams(await request.text()));
        return new Response("Ok.");
      }
      return new Response("Unexpected fixture request", { status: 500 });
    },
  });
  try {
    const proc = Bun.spawn(
      [
        "bash",
        "-c",
        'source "$1"; QBT_URL="$2"; main "$3"',
        "_",
        scriptPath,
        server.url.origin,
        target,
      ],
      {
        env: {
          ...Bun.env,
          QBT_USERNAME: "fixture",
          QBT_PASSWORD: "fixture",
          METADATA_WAIT_SECONDS: "1",
          METADATA_POLL_INTERVAL_SECONDS: "0",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { reads, mutations, stdout, stderr, code };
  } finally {
    await server.stop(true);
  }
}

describe("legacy hook and Media routing", () => {
  it.each([legacy.hash, "--all"])(
    "preserves Media limits for %s even before metadata",
    async (target) => {
      const result = await runHook([{ ...media, size: 0 }], target);
      expect(result.code).toBe(0);
      expect(result.mutations).toHaveLength(0);
      expect(result.reads).toBe(1);
    },
  );

  it("rechecks routing during metadata polling and immediately before mutation", async () => {
    for (const first of [legacy, { ...legacy, size: 0 }]) {
      const result = await runHook([first, media]);
      expect(result.code).toBe(0);
      expect(result.reads).toBe(2);
      expect(result.mutations).toHaveLength(0);
    }
  });

  it("preserves legacy behavior and the latest configured ratio", async () => {
    const result = await runHook(
      [legacy, { ...legacy, ratio_limit: 4 }],
      "--all",
    );
    expect(result.code).toBe(0);
    expect(result.mutations).toHaveLength(1);
    expect(result.mutations[0]?.get("ratioLimit")).toBe("4");
    expect(result.mutations[0]?.get("seedingTimeLimit")).toBe("6720");
    expect(result.mutations[0]?.get("shareLimitAction")).toBe("Default");
  });

  it.each([
    { category: "sonarr" },
    { auto_tmm: true },
    { tags: `media-${operation}` },
    { tags: `media-attempt-${attempt}` },
    { tags: `media-${operation}, media-attempt-${operation}` },
    { tags: `${media.tags}, media-attempt-${operation}` },
    { save_path: `/downloads/media/${attempt}/../${attempt}` },
    { save_path: `/downloads/media/${attempt}/nested` },
    { save_path: `/downloads/media/${attempt}//` },
    { save_path: `/downloads/media-other/${attempt}` },
  ])("does not exempt an incomplete routing identity: %j", async (change) => {
    const result = await runHook([{ ...media, ...change }]);
    expect(result.code).toBe(0);
    expect(result.mutations).toHaveLength(1);
  });

  it("accepts a single canonical trailing slash", async () => {
    const result = await runHook([
      { ...media, save_path: `${media.save_path}/` },
    ]);
    expect(result.code).toBe(0);
    expect(result.mutations).toHaveLength(0);
  });

  it("does not mutate a missing or mismatched torrent", async () => {
    for (const observations of [[], [{ ...legacy, hash: "b".repeat(40) }]]) {
      const result = await runHook(observations);
      expect(result.code).toBe(1);
      expect(result.mutations).toHaveLength(0);
    }
  });
});
