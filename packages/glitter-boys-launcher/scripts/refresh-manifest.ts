import path from "node:path";
import { readProfile } from "./release-profile.ts";
import { signingKey } from "./release-preflight.ts";
import {
  renewManifest,
  verifyPublication,
  sha256,
  type Envelope,
} from "./release-manifest.ts";
import { publishLauncher } from "../../../scripts/release/publish-launcher.ts";

const root = path.resolve(import.meta.dir, "..");
const profile = await readProfile(root);
async function download(url: string, maximum: number): Promise<Uint8Array> {
  const response = await fetch(url, {
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  if (response.status !== 200)
    throw new Error(
      `Could not read published release: HTTP ${response.status}`,
    );
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Published release has no body");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maximum)
        throw new Error("Published release exceeds size limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}
const envelope = JSON.parse(
  new TextDecoder().decode(await download(profile.manifest_url, 32 * 1024)),
) as Envelope;
const release = verifyPublication(
  envelope,
  profile.public_keys,
  profile.channel,
  true,
);
const archive = await download(release.artifact.url, release.artifact.bytes);
if (
  archive.length !== release.artifact.bytes ||
  sha256(archive) !== release.artifact.sha256
)
  throw new Error(
    "Published archive does not match its authenticated manifest",
  );
const installerName = `glitter-boys_${release.version}_x64-setup.exe`;
const installer = await download(
  `https://glitter-boys.com/launcher/releases/${release.version}/${installerName}`,
  128 * 1024 * 1024,
);
const renewed = renewManifest(
  envelope,
  profile.public_keys,
  profile.channel,
  await signingKey(profile),
);
const directory = path.join(root, "dist/release", release.version);
await Bun.write(path.join(directory, "launcher.zip"), archive);
await Bun.write(path.join(directory, installerName), installer);
await Bun.write(
  path.join(root, "dist/release", `${profile.channel}.json`),
  JSON.stringify(renewed),
);
await publishLauncher(true);
if (!process.argv.includes("--prepare-only")) await publishLauncher(false);
console.log(
  `Manifest for ${release.version} renewed until ${new Date(JSON.parse(renewed.payload).expires * 1000).toISOString()}; executable and installer bytes unchanged.`,
);
