/**
 * Regenerates (or, with `--check`, verifies) the reviewed bundled Codex
 * Bubblewrap helper pins from the root lockfile.
 *
 * For each Linux platform package the lockfile resolves, it downloads the
 * exact tarball, requires its sha512 to equal the lockfile integrity, and
 * hashes the bundled `codex-resources/bwrap` helper the worker image installs.
 * The resulting pins are bound to the artifact `bun install --frozen-lockfile`
 * places in the image; the promotion launcher re-verifies the installed copy.
 *
 * Usage (from packages/temporal): bun run codex:bubblewrap-pins [--check]
 */
import { createHash } from "node:crypto";
import { z } from "zod/v4";

const PINS_URL = new URL(
  "../src/lib/agent-runner/codex-bubblewrap-pins.json",
  import.meta.url,
);
const LOCK_URL = new URL("../../../bun.lock", import.meta.url);
const REGISTRY = "https://registry.npmjs.org";

const PlatformPin = z.strictObject({
  package: z.string().min(1),
  packageVersion: z.string().min(1),
  targetTriple: z.string().min(1),
  helperSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  packageIntegrity: z.string().startsWith("sha512-"),
});
const Pins = z.strictObject({
  codexVersion: z.string().min(1),
  platforms: z.strictObject({ arm64: PlatformPin, x64: PlatformPin }),
});
type Pins = z.infer<typeof Pins>;
type Architecture = keyof Pins["platforms"];
const ARCHITECTURES: readonly Architecture[] = ["arm64", "x64"];

function escapeRegExp(value: string) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

/** Reads `"<alias>": ["<name>@<version>", "", {...}, "<integrity>"]`. */
function lockedPlatform(lock: string, alias: string) {
  const entry = new RegExp(
    String.raw`^\s*"${escapeRegExp(alias)}": \["(?<spec>[^"]+)", "", \{[^\n]*\}, "(?<integrity>sha512-[^"]+)"\],$`,
    "mu",
  ).exec(lock);
  const spec = entry?.groups?.["spec"];
  const integrity = entry?.groups?.["integrity"];
  if (spec === undefined || integrity === undefined) {
    throw new Error(`bun.lock does not resolve ${alias}`);
  }
  const at = spec.lastIndexOf("@");
  return {
    name: spec.slice(0, at),
    version: spec.slice(at + 1),
    integrity,
  };
}

async function helperDigest(
  locked: ReturnType<typeof lockedPlatform>,
  targetTriple: string,
) {
  const basename = locked.name.split("/").at(-1) ?? locked.name;
  const tarballUrl = `${REGISTRY}/${locked.name}/-/${basename}-${locked.version}.tgz`;
  const response = await fetch(tarballUrl);
  if (!response.ok) {
    throw new Error(
      `Registry returned ${String(response.status)} for ${tarballUrl}`,
    );
  }
  const tarball = new Uint8Array(await response.arrayBuffer());
  const integrity = `sha512-${createHash("sha512").update(tarball).digest("base64")}`;
  if (integrity !== locked.integrity) {
    throw new Error(`${tarballUrl} differs from the bun.lock integrity`);
  }
  const member = `package/vendor/${targetTriple}/codex-resources/bwrap`;
  const tar = Bun.spawn(["tar", "-xzOf", "-", member], {
    stdin: new Blob([tarball]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [helper, stderr, code] = await Promise.all([
    new Response(tar.stdout).arrayBuffer(),
    new Response(tar.stderr).text(),
    tar.exited,
  ]);
  if (code !== 0 || helper.byteLength === 0) {
    throw new Error(`Extracting ${member} failed: ${stderr.trim()}`);
  }
  return createHash("sha256").update(new Uint8Array(helper)).digest("hex");
}

export async function derivePins(current: Pins, lock: string): Promise<Pins> {
  const platforms: Partial<Pins["platforms"]> = {};
  const versions = new Set<string>();
  for (const architecture of ARCHITECTURES) {
    const pin = current.platforms[architecture];
    const locked = lockedPlatform(lock, pin.package);
    const suffix = `-linux-${architecture}`;
    if (!locked.version.endsWith(suffix)) {
      throw new Error(
        `${pin.package} resolves to unexpected ${locked.version}`,
      );
    }
    versions.add(locked.version.slice(0, -suffix.length));
    platforms[architecture] = {
      package: pin.package,
      packageVersion: locked.version,
      targetTriple: pin.targetTriple,
      helperSha256: await helperDigest(locked, pin.targetTriple),
      packageIntegrity: locked.integrity,
    };
  }
  const [codexVersion, ...others] = versions;
  if (codexVersion === undefined || others.length > 0) {
    throw new Error("Linux platform packages resolve to different versions");
  }
  return Pins.parse({ codexVersion, platforms });
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  if (args.some((arg) => arg !== "--check")) {
    throw new Error("usage: codex-bubblewrap-pins.ts [--check]");
  }
  const current = Pins.parse(await Bun.file(PINS_URL).json());
  const derived = await derivePins(current, await Bun.file(LOCK_URL).text());
  const rendered = `${JSON.stringify(derived, null, 2)}\n`;
  if (args.includes("--check")) {
    if (rendered !== (await Bun.file(PINS_URL).text())) {
      console.error(
        "codex-bubblewrap-pins.json differs from bun.lock; regenerate it",
      );
      process.exit(1);
    }
    process.stdout.write(
      `Pins match bun.lock for Codex ${derived.codexVersion}\n`,
    );
  } else {
    await Bun.write(PINS_URL, rendered);
    process.stdout.write(`Wrote pins for Codex ${derived.codexVersion}\n`);
  }
}
