import { mkdtemp, rm } from "node:fs/promises";
import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { gameAssetManifest } from "@scout-for-lol/data/browser-assets";
import { GameFactSchema } from "@scout-for-lol/data/game-facts/schema.ts";
import type { Connect, PreviewServer } from "vite";
import { afterEach, describe, expect, test } from "vitest";
import {
  copyScoutAssets,
  decodeScoutAssetRequestUrl,
  resolveScoutAssetSource,
  scoutAssetStreamFailureAction,
  scoutAssetsPlugin,
  type ScoutAssetServerHooks,
  verifyScoutAssetBucket,
} from "./index.ts";

const FONT_ASSET_URL = "/assets/scout/fonts/Spiegel-TTF/Spiegel_TT_Regular.ttf";

const serversToClose: Server[] = [];

afterEach(async () => {
  while (serversToClose.length > 0) {
    const server = serversToClose.pop();
    if (server !== undefined) {
      await new Promise<void>((done) => {
        server.close(() => {
          done();
        });
      });
    }
  }
});

async function startAssetTestServer(
  hooks: ScoutAssetServerHooks,
): Promise<number> {
  const handlers: Connect.NextHandleFunction[] = [];
  const plugin = scoutAssetsPlugin({ hooks });
  const fakePreviewServer = {
    config: { base: "/" },
    middlewares: {
      use(fn: Connect.NextHandleFunction) {
        handlers.push(fn);
      },
    },
  };
  if (typeof plugin.configurePreviewServer === "function") {
    await plugin.configurePreviewServer.call(
      {} as never,
      fakePreviewServer as unknown as PreviewServer,
    );
  }
  const middleware = handlers[0];
  if (middleware === undefined) {
    throw new Error("scoutAssetsPlugin did not register a middleware");
  }

  const server = createServer((req, res) => {
    middleware(req, res, () => {
      res.statusCode = 404;
      res.end("unhandled");
    });
  });
  serversToClose.push(server);

  await new Promise<void>((done) => {
    server.listen(0, "127.0.0.1", () => {
      done();
    });
  });
  const address = server.address() as AddressInfo;
  return address.port;
}

describe("Scout asset request URLs", () => {
  test("rejects malformed percent encoding at the request boundary", () => {
    expect(decodeScoutAssetRequestUrl("/assets/scout/%ZZ.png")).toBeNull();
  });

  test("preserves valid encoded asset URLs", () => {
    expect(decodeScoutAssetRequestUrl("/assets/scout/Brand%20Mark.svg")).toBe(
      "/assets/scout/Brand Mark.svg",
    );
  });

  test("keeps resolved asset sources inside their declared root", () => {
    const root = "/srv/scout-assets";
    expect(resolveScoutAssetSource(root, "img/champion/Aatrox.png")).toBe(
      resolve(root, "img/champion/Aatrox.png"),
    );
    expect(resolveScoutAssetSource(root, "/etc/passwd")).toBeUndefined();
    expect(resolveScoutAssetSource(root, "../private.txt")).toBeUndefined();
    expect(resolveScoutAssetSource(root, "")).toBeUndefined();
  });

  test("ends unopened responses and destroys responses already in flight", () => {
    expect(scoutAssetStreamFailureAction(false)).toBe("not-found");
    expect(scoutAssetStreamFailureAction(true)).toBe("destroy");
  });
});

describe("emitted game facts", () => {
  test("ship beside the game images at game/<patch>/facts/<kind>/<key>.json", async () => {
    const outputRoot = await mkdtemp(resolve(tmpdir(), "scout-assets-"));
    try {
      await copyScoutAssets(outputRoot);
      await verifyScoutAssetBucket(outputRoot);
      const gameRoot = resolve(
        outputRoot,
        "assets/scout/game",
        gameAssetManifest.sourceVersion,
      );
      const samples = [
        ["champion", "Ahri"],
        ["ability", "Ahri-E"],
        ["item", "3118"],
        ["rune", "8112"],
        ["summoner-spell", "14"],
      ] as const;
      for (const [kind, key] of samples) {
        const fact = GameFactSchema.parse(
          await Bun.file(resolve(gameRoot, `facts/${kind}/${key}.json`)).json(),
        );
        expect(`${fact.kind}/${fact.key}`).toBe(`${kind}/${key}`);
        expect(fact.patch).toBe(gameAssetManifest.sourceVersion);
      }
    } finally {
      await rm(outputRoot, { recursive: true, force: true });
    }
  }, 120_000);
});

describe("Scout asset middleware stream lifecycle", () => {
  test("streams normal requests and cleans up mid-stream client aborts", async () => {
    let streamsCreated = 0;
    let openStreams = 0;
    const activeStreams: { destroy: () => void }[] = [];

    const port = await startAssetTestServer({
      openReadStream(source, defaultOpenReadStream) {
        const stream = defaultOpenReadStream(source, { highWaterMark: 1024 });
        streamsCreated += 1;
        openStreams += 1;
        activeStreams.push(stream);
        stream.once("close", () => {
          openStreams -= 1;
        });
        return stream;
      },
    });

    try {
      const response = await fetch(`http://127.0.0.1:${port.toString()}${FONT_ASSET_URL}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("font/ttf");
      const bytes = await response.arrayBuffer();
      expect(bytes.byteLength).toBeGreaterThan(10_000);

      await new Promise<void>((done, reject) => {
        const req = httpRequest(
          {
            hostname: "127.0.0.1",
            port,
            path: FONT_ASSET_URL,
            method: "GET",
          },
          (res) => {
            res.once("data", () => {
              req.destroy();
              done();
            });
          },
        );
        req.on("error", (error: NodeJS.ErrnoException) => {
          if (error.code === "ECONNRESET") {
            done();
            return;
          }
          reject(error);
        });
        req.end();
      });

      const deadline = Date.now() + 2_000;
      while (openStreams > 0 && Date.now() < deadline) {
        await Bun.sleep(10);
      }

      expect(streamsCreated).toBe(2);
      expect(openStreams).toBe(0);
    } finally {
      for (const stream of activeStreams) {
        stream.destroy();
      }
    }
  });

  test("does not open or leak a file stream when the client aborts while stat is pending", async () => {
    let streamsCreated = 0;
    let openStreams = 0;
    let statFinishedCount = 0;
    const statEntered = Promise.withResolvers<boolean>();
    const releaseStat = Promise.withResolvers<boolean>();

    const port = await startAssetTestServer({
      async statFile(source, defaultStat) {
        statEntered.resolve(true);
        await releaseStat.promise;
        const info = await defaultStat(source);
        statFinishedCount += 1;
        return info;
      },
      openReadStream(source, defaultOpenReadStream) {
        const stream = defaultOpenReadStream(source);
        streamsCreated += 1;
        openStreams += 1;
        stream.once("close", () => {
          openStreams -= 1;
        });
        return stream;
      },
    });

    const req = httpRequest({
      hostname: "127.0.0.1",
      port,
      path: FONT_ASSET_URL,
      method: "GET",
    });
    req.on("error", () => {
      // Expected ECONNRESET after client abort.
    });
    req.end();

    await statEntered.promise;
    req.destroy();
    await Bun.sleep(30);
    releaseStat.resolve(true);

    const deadline = Date.now() + 2_000;
    while (statFinishedCount === 0 && Date.now() < deadline) {
      await Bun.sleep(10);
    }
    await Bun.sleep(30);

    expect(statFinishedCount).toBe(1);
    expect(streamsCreated).toBe(0);
    expect(openStreams).toBe(0);
  });
});
