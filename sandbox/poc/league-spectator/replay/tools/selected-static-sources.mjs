import { realpath, mkdir, lstat } from "node:fs/promises";
import path from "node:path";
import { sha256 } from "../structural-comparison.mjs";
import { selectedStaticSourceIdentityByteLimit } from "../latest-static-source-authorities.mjs";
import { createStaticPreparationOutput } from "./map-scene-output.mjs";

const digest = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const exact = (value, keys) =>
  value &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join("|") === [...keys].sort().join("|");
const boundedPath = (value) =>
  typeof value === "string" &&
  value.length <= 512 &&
  /^[-A-Za-z0-9_./]+$/.test(value) &&
  !value.startsWith("/") &&
  value.split("/").every((part) => part && part !== "." && part !== "..");
const contains = (root, candidate) => {
  const normalize = (value) =>
    process.platform === "win32" ? value.toLowerCase() : value;
  return normalize(candidate).startsWith(normalize(root + path.sep));
};
async function canonicalDestination(input) {
  let candidate = path.resolve(input);
  const suffix = [];
  for (;;) {
    try {
      return path.join(await realpath(candidate), ...suffix);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      suffix.unshift(path.basename(candidate));
      const parent = path.dirname(candidate);
      if (candidate === parent) throw error;
      candidate = parent;
    }
  }
}
function assertDisjoint(left, right) {
  const compare = (value) =>
    process.platform === "win32" ? value.toLowerCase() : value;
  if (
    compare(left) === compare(right) ||
    contains(left, right) ||
    contains(right, left)
  )
    throw Error(
      "Selected source and output roots must be canonically disjoint",
    );
}
const kinds = {
  build: "approved-exact-build-public",
  scene: "prepared-scene-public",
  animation: "prepared-scene-animation",
};

// This is a preparation contract, not native rendering admission. Logical
// authorities have no host paths; the caller supplies those separately.
export function validateSelectedStaticSourcePlan(plan) {
  if (
    !exact(plan, ["schema", "kind", "sources", "files"]) ||
    plan.schema !== 1 ||
    plan.kind !== "selected-static-source-plan" ||
    !plan.sources ||
    !plan.files
  )
    throw Error("Explicit selected static source plan required");
  const authorities = Object.keys(plan.sources);
  if (
    !authorities.includes("build") ||
    !authorities.includes("scene") ||
    authorities.length > 32 ||
    authorities.some(
      (authority) => !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(authority),
    )
  )
    throw Error("Explicit build/scene source authorities required");
  for (const [authority, source] of Object.entries(plan.sources)) {
    if (
      !exact(source, ["kind", "identity"]) ||
      source.kind !==
        (Object.hasOwn(kinds, authority)
          ? kinds[authority]
          : "prepared-scene-package") ||
      !exact(source.identity, ["file", "sha256", "bytes"]) ||
      !boundedPath(source.identity.file) ||
      !digest(source.identity.sha256) ||
      !Number.isSafeInteger(source.identity.bytes) ||
      source.identity.bytes < 1 ||
      source.identity.bytes > selectedStaticSourceIdentityByteLimit(source.kind)
    )
      throw Error("Bounded source identity required: " + authority);
  }
  const entries = Object.entries(plan.files);
  if (!entries.length || entries.length > 65536)
    throw Error("Bounded selected source inventory required");
  const folded = entries.map(([target]) => target.toLowerCase());
  if (new Set(folded).size !== entries.length)
    throw Error("Selected source targets cannot alias by case");
  let totalBytes = 0;
  for (const [target, entry] of entries) {
    if (
      !boundedPath(target) ||
      !exact(entry, ["source", "sha256", "bytes"]) ||
      !exact(entry.source, ["authority", "file"]) ||
      !Object.hasOwn(plan.sources, entry.source.authority) ||
      !boundedPath(entry.source.file) ||
      !digest(entry.sha256) ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 0 ||
      entry.bytes > 512 * 1024 * 1024
    )
      throw Error("Invalid selected source declaration: " + target);
    if (
      [
        "latest-static-sources.json",
        "latest-static-catalog/bootstrap.json",
        "latest-static-catalog/catalog.json",
      ].includes(target.toLowerCase())
    )
      throw Error(
        "Selected source plan cannot publish generated admission metadata",
      );
    totalBytes += entry.bytes;
    if (totalBytes > 8 * 1024 * 1024 * 1024)
      throw Error("Selected source closure exceeds preparation quota");
  }
  for (const [authority, source] of Object.entries(plan.sources)) {
    const identity = source.identity;
    if (
      !entries.some(
        ([, entry]) =>
          entry.source.authority === authority &&
          entry.source.file === identity.file &&
          entry.sha256 === identity.sha256 &&
          entry.bytes === identity.bytes,
      )
    )
      throw Error("Source identity absent from closed inventory: " + authority);
  }
  return plan;
}

async function exactFile(root, relative) {
  let current = root;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    if ((await lstat(current)).isSymbolicLink())
      throw Error("Selected source cannot follow links: " + relative);
  }
  const canonical = await realpath(current);
  if (!contains(root, canonical) || !(await lstat(canonical)).isFile())
    throw Error("Selected source escaped its authority: " + relative);
  return canonical;
}

export async function createSelectedStaticSourceReader({ plan, roots }) {
  plan = structuredClone(plan);
  roots = structuredClone(roots);
  validateSelectedStaticSourcePlan(plan);
  if (!exact(roots, Object.keys(plan.sources)))
    throw Error("One explicit root per declared authority required");
  const canonicalRoots = {};
  for (const [authority, root] of Object.entries(roots))
    canonicalRoots[authority] = await realpath(path.resolve(root));
  const captured = new Map();
  async function readSource(source, expected) {
    const canonical = await exactFile(
      canonicalRoots[source.authority],
      source.file,
    );
    const file = Bun.file(canonical);
    if (file.size !== expected.bytes)
      throw Error(
        "Selected source size differs: " + source.authority + ":" + source.file,
      );
    const bytes = await file.bytes();
    if (
      bytes.length !== expected.bytes ||
      (await sha256(bytes)) !== expected.sha256
    )
      throw Error(
        "Selected source bytes differ: " + source.authority + ":" + source.file,
      );
    const previous = captured.get(canonical);
    if (
      previous &&
      (previous.sha256 !== expected.sha256 || previous.bytes !== expected.bytes)
    )
      throw Error("Conflicting source identity: " + source.file);
    captured.set(canonical, { ...expected, source: { ...source } });
    return bytes;
  }
  // Authenticate each logical root before publishing any namespace.
  for (const [authority, { identity }] of Object.entries(plan.sources))
    await readSource({ authority, file: identity.file }, identity);
  return {
    roots: Object.freeze(canonicalRoots),
    async read(target) {
      const entry = plan.files[target];
      if (!Object.hasOwn(plan.files, target))
        throw Error("File outside selected source plan: " + target);
      return readSource(entry.source, entry);
    },
    async verifyUnchanged() {
      for (const [canonical, entry] of captured) {
        const current = await exactFile(
          canonicalRoots[entry.source.authority],
          entry.source.file,
        );
        const file = Bun.file(current);
        if (file.size !== entry.bytes)
          throw Error(
            "Selected source changed during preparation: " + entry.source.file,
          );
        const bytes = await file.bytes();
        if (
          current !== canonical ||
          bytes.length !== entry.bytes ||
          (await sha256(bytes)) !== entry.sha256
        )
          throw Error(
            "Selected source changed during preparation: " + entry.source.file,
          );
      }
    },
    describe: () =>
      structuredClone({ sources: plan.sources, files: plan.files }),
  };
}

export async function publishSelectedStaticSources({
  plan,
  roots,
  outputCache,
}) {
  plan = structuredClone(plan);
  roots = structuredClone(roots);
  const reader = await createSelectedStaticSourceReader({ plan, roots });
  // All roots must be disjoint from output, including aliases and parent paths.
  // The shared helper performs the canonical check before creating a namespace.
  const outputCanonical = await canonicalDestination(outputCache);
  for (const root of Object.values(reader.roots))
    assertDisjoint(root, outputCanonical);
  const output = await createStaticPreparationOutput(
    reader.roots.build,
    outputCache,
    {
      prefix: "selected-",
      directory: "selected-source-check",
    },
  );
  for (const root of Object.values(reader.roots))
    assertDisjoint(root, output.runRoot);
  const publicRoot = path.join(output.runRoot, "public");
  for (const target of Object.keys(plan.files)) {
    const bytes = await reader.read(target);
    const destination = path.join(publicRoot, target);
    // Bun's Windows writer rejects an otherwise valid 260-character path unless
    // it uses the native namespace. Canonical source/output containment checks
    // above still operate on the original resolved paths.
    const filePath = path.toNamespacedPath(destination);
    await mkdir(path.dirname(filePath), { recursive: true });
    await Bun.write(filePath, bytes);
  }
  await reader.verifyUnchanged();
  const receipt = {
    schema: 1,
    kind: "verified-selected-static-source-closure",
    ...reader.describe(),
    nativeSpectatorAdmitted: false,
  };
  // Only successful runs receive a receipt. This root is a staging input to the
  // catalog producer, and has no bootstrap/ready claim of its own.
  await Bun.write(
    path.join(output.runRoot, "research", "selected-static-sources.json"),
    JSON.stringify({ ...receipt, inputRoots: reader.roots }, null, 2),
  );
  await Bun.write(
    path.join(publicRoot, "latest-static-sources.json"),
    JSON.stringify(receipt, null, 2),
  );
  return { publicRoot, receipt };
}
