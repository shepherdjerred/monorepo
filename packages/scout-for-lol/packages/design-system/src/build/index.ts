import { createReadStream } from "node:fs";
import { cp, mkdir, stat, writeFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gameAssetManifest } from "@scout-for-lol/data/browser-assets";
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
  if (extension === ".ttf") return "font/ttf";
  if (extension === ".otf") return "font/otf";
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

function configureAssetServer(middlewares: Connect.Server): void {
  middlewares.use((request, response, next) => {
    const url = request.url?.split("?")[0];
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
    void stat(source)
      .then(() => {
        response.setHeader("content-type", mimeType(source));
        const stream = createReadStream(source);
        stream.on("error", () => {
          if (scoutAssetStreamFailureAction(response.headersSent) === "destroy") {
            response.destroy();
            return;
          }
          response.statusCode = 404;
          response.end("Not found");
        });
        response.on("close", () => {
          stream.destroy();
        });
        stream.pipe(response);
      })
      .catch(() => {
        response.statusCode = 404;
        response.end("Not found");
      });
  });
}

export function scoutAssetsPlugin(options: { emit?: boolean } = {}): Plugin {
  let outputRoot = "";
  return {
    name: "scout-shared-assets",
    configResolved(config) {
      outputRoot = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      configureAssetServer(server.middlewares);
    },
    configurePreviewServer(server) {
      configureAssetServer(server.middlewares);
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
    cp(
      resolve(dataAssetsRoot, "img"),
      resolve(root, "game", gameAssetManifest.sourceVersion, "img"),
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
  for (const path of [
    "assets/scout/brand/emblem.svg",
    "assets/scout/brand/theme-bootstrap.js",
    "assets/scout/fonts/Spiegel-TTF/Spiegel_TT_Regular.ttf",
    "assets/scout/shared/ranks/Rank=Challenger.png",
  ]) {
    await stat(resolve(outputRoot, path));
  }
}
