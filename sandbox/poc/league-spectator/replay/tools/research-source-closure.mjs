// Read-only proof helper. Capture before dynamic consumer imports, then compare
// again at completion; this is source lineage, not module authentication.
export async function captureResearchSourceClosure(roots) {
  const scanner = new Bun.Transpiler({ loader: "js", target: "bun" }),
    found = new Map();
  async function read(url) {
    if (found.has(url.href)) return;
    const bytes = await Bun.file(url).bytes();
    found.set(
      url.href,
      new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
    );
    if (/\.(?:mjs|cjs|js|ts)$/.test(url.pathname))
      for (const item of scanner.scanImports(new TextDecoder().decode(bytes)))
        if (item.path.startsWith("./") || item.path.startsWith("../"))
          await read(new URL(item.path, url));
  }
  for (const root of roots) await read(root);
  return Object.fromEntries([...found].sort(([a], [b]) => a.localeCompare(b)));
}
