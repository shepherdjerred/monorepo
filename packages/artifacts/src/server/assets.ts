import path from "node:path";

export type StaticAsset = {
  bytes: Uint8Array<ArrayBuffer>;
  contentType: string;
  etag: string;
};

const JS = "text/javascript; charset=utf-8";

async function shortHash(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const full = await sha256Hex(bytes);
  return full.slice(0, 16);
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString(
    "hex",
  );
}

export type BridgeAssets = {
  /** What injected HTML references: `/_bridge/<content-hash>.js`. */
  src: string;
  /** Short hash of the bridge, part of every rewritten HTML ETag. */
  hash: string;
  get: (file: string) => StaticAsset | undefined;
};

/**
 * Transpiles the bridge once at startup with the app origin baked in. It is
 * served as `v1.js` (a stable alias) and as `<hash>.js`, which is what pages
 * reference so the URL changes whenever the code does.
 */
export async function buildBridge(appOrigin: string): Promise<BridgeAssets> {
  const source = await Bun.file(
    new URL("../bridge/bridge.ts", import.meta.url),
  ).text();
  const transpiler = new Bun.Transpiler({
    loader: "ts",
    minifyWhitespace: true,
  });
  const compiled = transpiler
    .transformSync(source)
    .replace(/["']__APP_ORIGIN__["']/u, JSON.stringify(appOrigin));
  if (compiled.includes("__APP_ORIGIN__"))
    throw new Error("The bridge's app origin placeholder was not replaced");
  const bytes = new TextEncoder().encode(compiled);
  const hash = await shortHash(bytes);
  const asset: StaticAsset = { bytes, contentType: JS, etag: `"${hash}"` };
  const files = new Map([
    ["v1.js", asset],
    [`${hash}.js`, asset],
  ]);
  return {
    src: `/_bridge/${hash}.js`,
    hash: hash.slice(0, 8),
    get: (file) => files.get(file),
  };
}

export type ViewerAssets = {
  /** The Mermaid viewer's entry script path, building the bundle on first use. */
  mermaidEntry: () => Promise<string>;
  get: (file: string) => Promise<StaticAsset | undefined>;
};

const MERMAID_ENTRY = new URL("../viewer/mermaid-viewer.ts", import.meta.url)
  .pathname;

/**
 * Bundles the self-hosted Mermaid viewer on first request (it is large) and
 * serves its chunks from `/_viewer/`. Chunk names carry content hashes.
 */
export function createViewerAssets(): ViewerAssets {
  let built:
    Promise<{ entry: string; files: Map<string, StaticAsset> }> | undefined;

  async function build() {
    const result = await Bun.build({
      entrypoints: [MERMAID_ENTRY],
      root: path.dirname(MERMAID_ENTRY),
      target: "browser",
      format: "esm",
      splitting: true,
      minify: true,
      naming: {
        entry: "mermaid-viewer-[hash].[ext]",
        chunk: "chunk-[hash].[ext]",
        asset: "asset-[hash].[ext]",
      },
    });
    if (!result.success)
      throw new Error(
        `The Mermaid viewer failed to build: ${result.logs.map(String).join("; ")}`,
      );
    const files = new Map<string, StaticAsset>();
    let entry = "";
    for (const output of result.outputs) {
      const name = output.path.replace(/^\.\//u, "");
      const bytes = new Uint8Array(await output.arrayBuffer());
      files.set(name, {
        bytes,
        contentType: name.endsWith(".js") ? JS : output.type,
        etag: `"${await shortHash(bytes)}"`,
      });
      if (output.kind === "entry-point") entry = name;
    }
    if (entry === "")
      throw new Error("The Mermaid viewer build has no entry point");
    return { entry, files };
  }

  const ready = () => {
    built ??= build();
    return built;
  };
  return {
    mermaidEntry: async () => {
      const bundle = await ready();
      return `/_viewer/${bundle.entry}`;
    },
    get: async (file) => {
      const bundle = await ready();
      return bundle.files.get(file);
    },
  };
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * The page `/_t/<token>/` serves for a Mermaid artifact. It names the diagram
 * source as a relative path, so the fetch stays inside the token prefix.
 */
export function mermaidViewerHtml(options: {
  entryPath: string;
  viewerScript: string;
  bridgeSrc: string;
}): string {
  const source = `./${options.entryPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="${escapeAttribute(options.bridgeSrc)}"></script>
<title>Diagram</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 24px; font: 14px system-ui, sans-serif; display: flex; justify-content: center; }
  #diagram svg { max-width: 100%; height: auto; }
  .error { color: #b3261e; white-space: pre-wrap; }
</style>
</head>
<body data-source="${escapeAttribute(source)}">
<div id="diagram">Rendering...</div>
<script type="module" src="${escapeAttribute(options.viewerScript)}"></script>
</body>
</html>
`;
}
