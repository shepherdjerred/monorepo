// Deliberately separate lexical scope: retaining a loader must not retain the
// report, events, pose ownership or initialization payload of its caller.
export function createDirectSessionResourceLoader(assetBase, inputLoad = null) {
  if (inputLoad !== null && typeof inputLoad !== "function")
    throw Error("Explicit preparation resource callback required");
  const loaded = new Map();
  return (path) => {
    if (!loaded.has(path))
      loaded.set(
        path,
        (async () => {
          if (inputLoad !== null) {
            const bytes = await inputLoad(path);
            if (!(bytes instanceof Uint8Array))
              throw Error("Preparation resource bytes required");
            return bytes;
          }
          const response = await fetch(new URL(path, assetBase));
          if (response.status !== 200)
            throw Error(`Direct effect asset HTTP ${response.status}: ${path}`);
          return new Uint8Array(await response.arrayBuffer());
        })(),
      );
    return loaded.get(path);
  };
}
