import { expect, test } from "vitest";
import { QbittorrentClient } from "./qbittorrent.ts";
import { torrentInfoHashes } from "./torrent.ts";
import fixture from "./fixtures/qbittorrent-5.2.4.json" with { type: "json" };

const operationId = "00000000-0000-4000-8000-000000000001";
const attemptId = "00000000-0000-4000-8000-000000000002";
const savePath = `/downloads/media/${attemptId}`;
const config = {
  baseUrl: "http://qbit.fixture",
  username: "fixture",
  password: "fixture",
  category: "media",
};
const login = () =>
  new Response(null, {
    status: 204,
    headers: { "set-cookie": "QBT_SID_8080=fixture" },
  });

test.each(["magnet", "torrent"])(
  "%s refuses an expired guard after observe without wrapping it as an uncertain add",
  async (kind) => {
    const identity = fixture.uploads[0];
    if (identity === undefined)
      throw new Error("Actual torrent fixture missing");
    let observed = false;
    let adds = 0;
    const client = new QbittorrentClient(config, async (url, init) => {
      if (url.pathname.endsWith("/login")) return login();
      expect(init.signal).toBeDefined();
      if (url.pathname.endsWith("/info")) {
        observed = true;
        return Response.json([]);
      }
      adds++;
      throw new Error("Unexpected add POST");
    });
    await client.login();
    const refused = new Error("Trusted authority expired during observation");
    const beforeMutation = () => {
      expect(observed).toBe(true);
      throw refused;
    };
    const signal = new AbortController().signal;
    const common = {
      operationId,
      attemptId,
      savePath,
      hash: identity.infohash_v1,
    };
    const result =
      kind === "magnet"
        ? client.submit(
            {
              ...common,
              magnet: `magnet:?xt=urn:btih:${identity.infohash_v1}`,
            },
            signal,
            beforeMutation,
          )
        : client.submitTorrent(
            { ...common, bytes: Buffer.from(identity.torrentBase64, "base64") },
            signal,
            beforeMutation,
          );
    await expect(result).rejects.toBe(refused);
    expect(adds).toBe(0);
  },
);

test("reads the authenticated application version and rejects unrecognized responses", async () => {
  let body = "v5.2.4";
  const client = new QbittorrentClient(config, async (url, init) => {
    if (url.pathname.endsWith("/login")) return login();
    expect(url.pathname).toBe("/api/v2/app/version");
    expect(init.method).toBe("GET");
    return new Response(body);
  });
  await client.login();
  await expect(client.version()).resolves.toBe("v5.2.4");
  body = "<html>unexpected proxy</html>";
  await expect(client.version()).rejects.toThrow();
});

test.each(fixture.uploads)(
  "resolves full cryptographic $kind identity and deletes only the observed qBit ID",
  async (identity) => {
    const hashes = torrentInfoHashes(
      Buffer.from(identity.torrentBase64, "base64"),
    );
    expect(hashes).toEqual({
      v1: identity.infohash_v1 || null,
      v2: identity.infohash_v2 || null,
    });
    let deleted: string | null = null;
    const client = new QbittorrentClient(config, async (url, init) => {
      if (url.pathname.endsWith("/login")) return login();
      expect(new Headers(init.headers).get("cookie")).toBe(
        "QBT_SID_8080=fixture",
      );
      if (url.pathname.endsWith("/delete")) {
        if (!(init.body instanceof URLSearchParams))
          throw new TypeError("Expected form");
        deleted = init.body.get("hashes");
        return new Response();
      }
      expect(url.searchParams.has("hashes")).toBe(false);
      return Response.json([
        {
          ...identity,
          ...fixture.unlimited,
          name: "fixture",
          state: "stalledUP",
          category: "media",
          tags: `media-${operationId},media-attempt-${attemptId}`,
          progress: 1,
          ratio: 1,
          seeding_time: 1,
          size: 1,
          save_path: savePath,
          content_path: `${savePath}/fixture.mkv`,
        },
      ]);
    });
    await client.login();
    for (const hash of [identity.infohash_v1, identity.infohash_v2].filter(
      Boolean,
    )) {
      const observed = await client.observe(hash);
      expect(observed?.hash).toBe(identity.hash);
      await client.remove({
        hash,
        operationId,
        attemptId,
        savePath,
        deleteFiles: true,
      });
      expect(deleted).toBe(identity.hash);
    }
    if (identity.kind !== "v1")
      expect(await client.observe(identity.hash)).toBeNull();
  },
);

test("accepts pinned JSON add response and protects ambiguous/pending/legacy replies", async () => {
  for (const response of [
    fixture.add,
    { ...fixture.add, pending_count: 1 },
    { ...fixture.add, added_torrent_ids: ["b".repeat(40)] },
    { ...fixture.add, failure_count: 1 },
    "Ok.",
  ]) {
    let posts = 0;
    const client = new QbittorrentClient(config, async (url) => {
      if (url.pathname.endsWith("/login")) return login();
      if (url.pathname.endsWith("/info")) return Response.json([]);
      posts++;
      return typeof response === "string"
        ? new Response(response)
        : Response.json(response);
    });
    await client.login();
    const submission = client.submit({
      hash: "a".repeat(40),
      operationId,
      attemptId,
      savePath,
      magnet: `magnet:?xt=urn:btih:${"a".repeat(40)}`,
    });
    if (response === fixture.add)
      await expect(submission).resolves.toBe("accepted");
    else
      await expect(submission).rejects.toMatchObject({
        kind: "outcome-unknown",
      });
    expect(posts).toBe(1);
  }
});

test("rejects missing or ambiguous session cookies", async () => {
  for (const cookies of [
    "other=fixture",
    "QBT_SID_8080=first, QBT_SID_9090=second",
    "SID=first, QBT_SID_8080=second",
  ]) {
    const client = new QbittorrentClient(
      config,
      async () =>
        new Response(null, { status: 204, headers: { "set-cookie": cookies } }),
    );
    await expect(client.login()).rejects.toMatchObject({
      kind: "authentication",
    });
  }
});

test("hybrid magnet add accepts its validated full-v2 alias wire ID", async () => {
  const v1 = "d".repeat(40);
  const v2 = "e".repeat(64);
  const client = new QbittorrentClient(config, async (url) => {
    if (url.pathname.endsWith("/login")) return login();
    if (url.pathname.endsWith("/info")) return Response.json([]);
    return Response.json({
      added_torrent_ids: [v2.slice(0, 40)],
      success_count: 1,
      failure_count: 0,
      pending_count: 0,
    });
  });
  await client.login();
  await expect(
    client.submit({
      operationId,
      attemptId,
      savePath,
      hash: v1,
      magnet: `magnet:?xt=urn:btih:${v1}&xt=urn:btmh:1220${v2}`,
    }),
  ).resolves.toBe("accepted");
});

test("conflicting and malformed magnet aliases fail before any network effect", async () => {
  const hash = "a".repeat(40);
  let requests = 0;
  const client = new QbittorrentClient(config, async () => {
    requests++;
    throw new Error("Unexpected network effect");
  });
  for (const alias of [
    `urn:btih:${"b".repeat(40)}`,
    "urn:btih:malformed",
    "urn:btmh:1220bad",
    `urn:btmh:1220${"c".repeat(64)}&xt=urn:btmh:1220${"d".repeat(64)}`,
  ]) {
    await expect(
      client.submit({
        operationId,
        attemptId,
        savePath,
        hash,
        magnet: `magnet:?xt=urn:btih:${hash}&xt=${alias}`,
      }),
    ).rejects.toThrow();
  }
  expect(requests).toBe(0);
});
