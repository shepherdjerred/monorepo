import { createReadStream } from "node:fs";
import { cp, mkdir, stat, writeFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gameAssetManifest } from "@scout-for-lol/data/browser-assets";
import {
  GameFactSchema,
  gameFactPath,
} from "@scout-for-lol/data/game-facts/schema.ts";
import type { Connect, Plugin } from "vite";
import { SCOUT_THEME_BOOTSTRAP_SCRIPT } from "#src/runtime/bootstrap.ts";

const packageRoot = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../..",
);
const dataAssetsRoot = resolve(packageRoot, "../data/src/data-dragon/assets");
const ownedAssetsRoot = resolve(packageRoot, "assets");

function mimeType(path: string): string {
  const extension = extname(path);
  if (extension === ".png") return "image/png";
  if (extension === ".jpg") return "image/jpeg";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".js") return "text/javascript; charset=utf-8";
  if (extension === ".json") return "application/json; charset=utf-8";
  if (extension === ".ttf") return "font/ttf";
  if (extension === ".otf") return "font/otf";
  if (extension === ".woff2") return "font/woff2";
  if (extension === ".woff") return "font/woff";
  return "application/octet-stream";
}

export function resolveScoutAssetSource(
  root: string,
  relativePath: string,
): string | undefined {
  if (relativePath.length === 0 || isAbsolute(relativePath)) return undefined;
  const source = resolve(root, relativePath);
  const pathFromRoot = relative(root, source);
  if (
    pathFromRoot === "" ||
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot)
  ) {
    return undefined;
  }
  return source;
}

function sourceForUrl(url: string): string | undefined {
  const gamePrefix = `/assets/scout/game/${gameAssetManifest.sourceVersion}/`;
  if (url.startsWith(gamePrefix)) {
    return resolveScoutAssetSource(
      dataAssetsRoot,
      url.slice(gamePrefix.length),
    );
  }
  const fontPrefix = "/assets/scout/fonts/";
  if (url.startsWith(fontPrefix))
    return resolveScoutAssetSource(
      resolve(ownedAssetsRoot, "fonts"),
      url.slice(fontPrefix.length),
    );
  const ranksPrefix = "/assets/scout/shared/ranks/";
  const mapsPrefix = "/assets/scout/maps/";
  if (url.startsWith(mapsPrefix))
    return resolveScoutAssetSource(
      resolve(ownedAssetsRoot, "maps"),
      url.slice(mapsPrefix.length),
    );
  if (url.startsWith(ranksPrefix))
    return resolveScoutAssetSource(
      resolve(ownedAssetsRoot, "ranks"),
      url.slice(ranksPrefix.length),
    );
  const brandPrefix = "/assets/scout/brand/";
  if (url.startsWith(brandPrefix) && !url.endsWith("theme-bootstrap.js"))
    return resolveScoutAssetSource(
      resolve(ownedAssetsRoot, "brand"),
      url.slice(brandPrefix.length),
    );
  return undefined;
}

export function decodeScoutAssetRequestUrl(url: string): string | null {
  try {
    return decodeURIComponent(url);
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
}

export function scoutAssetStreamFailureAction(
  headersSent: boolean,
): "not-found" | "destroy" {
  return headersSent ? "destroy" : "not-found";
}

export type ScoutAssetServerHooks = {
  readonly statFile?: (
    source: string,
    defaultStat: typeof stat,
  ) => Promise<unknown>;
  readonly openReadStream?: (
    source: string,
    defaultOpenReadStream: typeof createReadStream,
  ) => ReturnType<typeof createReadStream>;
};

function serveScoutAssetFile(
  source: string,
  response: Parameters<Connect.NextHandleFunction>[1],
  hooks: ScoutAssetServerHooks,
): void {
  let closed = false;
  response.once("close", () => {
    closed = true;
  });
  const isResponseClosed = (): boolean =>
    closed || response.destroyed || response.writableEnded;
  const runStat = hooks.statFile
    ? hooks.statFile(source, stat)
    : stat(source);

  void runStat
    .then(() => {
      if (isResponseClosed()) {
        return;
      }
      response.setHeader("content-type", mimeType(source));
      const stream = hooks.openReadStream
        ? hooks.openReadStream(source, createReadStream)
        : createReadStream(source);
      const destroyStream = (): void => {
        if (!stream.destroyed) {
          stream.destroy();
        }
      };
      stream.on("error", () => {
        if (isResponseClosed()) {
          destroyStream();
          return;
        }
        if (scoutAssetStreamFailureAction(response.headersSent) === "destroy") {
          response.destroy();
          return;
        }
        response.statusCode = 404;
        response.end("Not found");
      });
      response.once("close", destroyStream);
      if (isResponseClosed()) {
        destroyStream();
        return;
      }
      stream.pipe(response);
    })
    .catch(() => {
      if (isResponseClosed()) {
        return;
      }
      response.statusCode = 404;
      response.end("Not found");
    });
}

function configureAssetServer(
  middlewares: Connect.Server,
  base: string,
  hooks: ScoutAssetServerHooks = {},
): void {
  const basePrefix = base === "/" ? "" : base.replace(/\/$/, "");
  middlewares.use((request, response, next) => {
    const requestPath = request.url?.split("?")[0];
    const url =
      basePrefix.length > 0 && requestPath?.startsWith(`${basePrefix}/`)
        ? requestPath.slice(basePrefix.length)
        : requestPath;
    if (url === "/assets/scout/brand/theme-bootstrap.js") {
      response.setHeader("content-type", "text/javascript; charset=utf-8");
      response.end(SCOUT_THEME_BOOTSTRAP_SCRIPT);
      return;
    }
    if (url === undefined) {
      next();
      return;
    }
    const decodedUrl = decodeScoutAssetRequestUrl(url);
    if (decodedUrl === null || decodedUrl.includes("..")) {
      response.statusCode = 400;
      response.end("Invalid asset path");
      return;
    }
    const source = sourceForUrl(decodedUrl);
    if (source === undefined) {
      next();
      return;
    }
    serveScoutAssetFile(source, response, hooks);
  });
}

export function scoutAssetsPlugin(
  options: { emit?: boolean; hooks?: ScoutAssetServerHooks } = {},
): Plugin {
  let outputRoot = "";
  return {
    name: "scout-shared-assets",
    configResolved(config) {
      outputRoot = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      configureAssetServer(server.middlewares, server.config.base, options.hooks);
    },
    configurePreviewServer(server) {
      configureAssetServer(server.middlewares, server.config.base, options.hooks);
    },
    async closeBundle() {
      if (options.emit === true) {
        await copyScoutAssets(outputRoot);
      }
    },
  };
}

export async function copyScoutAssets(outputRoot: string): Promise<void> {
  const root = resolve(outputRoot, "assets/scout");
  await Promise.all([
    cp(resolve(ownedAssetsRoot, "maps"), resolve(root, "maps"), {
      recursive: true,
    }),
    cp(
      resolve(dataAssetsRoot, "img"),
      resolve(root, "game", gameAssetManifest.sourceVersion, "img"),
      { recursive: true },
    ),
    // Per-entity tooltip facts, served at game/<patch>/facts/<kind>/<key>.json.
    cp(
      resolve(dataAssetsRoot, "facts"),
      resolve(root, "game", gameAssetManifest.sourceVersion, "facts"),
      { recursive: true },
    ),
    cp(resolve(ownedAssetsRoot, "fonts"), resolve(root, "fonts"), {
      recursive: true,
    }),
    cp(resolve(ownedAssetsRoot, "ranks"), resolve(root, "shared/ranks"), {
      recursive: true,
    }),
    cp(resolve(ownedAssetsRoot, "brand"), resolve(root, "brand"), {
      recursive: true,
    }),
  ]);
  await mkdir(resolve(root, "brand"), { recursive: true });
  await writeFile(
    resolve(root, "brand/theme-bootstrap.js"),
    SCOUT_THEME_BOOTSTRAP_SCRIPT,
  );
}

export async function verifyScoutAssetBucket(
  outputRoot: string,
): Promise<void> {
  for (const asset of gameAssetManifest.assets) {
    const path = resolve(
      outputRoot,
      "assets/scout/game",
      gameAssetManifest.sourceVersion,
      asset.relativePath,
    );
    await stat(path);
    const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
    const hasher = new Bun.CryptoHasher("sha256");
    hasher.update(bytes);
    const actualHash = hasher.digest("hex");
    if (actualHash !== asset.sha256) {
      throw new Error(
        `Built Scout asset ${asset.relativePath} has SHA-256 ${actualHash}, expected ${asset.sha256}`,
      );
    }
  }
  await verifyGameFactFiles(outputRoot);
  for (const path of [
    "assets/scout/brand/emblem.svg",
    "assets/scout/brand/theme-bootstrap.js",
    "assets/scout/fonts/Spiegel-TTF/Spiegel_TT_Regular.ttf",
    "assets/scout/shared/ranks/Rank=Challenger.png",
  ]) {
    await stat(resolve(outputRoot, path));
  }
}

/** One emitted fact file per kind must exist and parse as the entity it names. */
const FACT_SAMPLES = [
  ["champion", "Ahri"],
  ["ability", "Ahri-E"],
  ["item", "3118"],
  ["rune", "8112"],
  ["summoner-spell", "14"],
] as const;

async function verifyGameFactFiles(outputRoot: string): Promise<void> {
  for (const [kind, key] of FACT_SAMPLES) {
    const path = resolve(
      outputRoot,
      "assets/scout/game",
      gameAssetManifest.sourceVersion,
      gameFactPath(kind, key),
    );
    const fact = GameFactSchema.parse(await Bun.file(path).json());
    if (fact.kind !== kind || fact.key !== key) {
      throw new Error(`Built game fact ${path} holds ${fact.kind}/${fact.key}`);
    }
  }
}
