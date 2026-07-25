#!/usr/bin/env bun

import { dirname, join } from "path";
import { fileURLToPath } from "url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const readmeFile = join(scriptDir, "../../README.md");

// One entry per node: schematic source → pinned installer reference. Every
// node's pin is checked/updated; add new nodes here.
const NODES = [
  {
    name: "torvalds",
    schematicFile: join(scriptDir, "torvalds/image.yaml"),
    patchFile: join(scriptDir, "torvalds/patches/image.yaml"),
  },
  {
    name: "liskov",
    schematicFile: join(scriptDir, "liskov/image.yaml"),
    patchFile: join(scriptDir, "liskov/patches/image.yaml"),
  },
];

// With --check the script verifies (without writing) that the pinned schematic
// ID + digest in patches/image.yaml still match what image.yaml produces, then
// exits non-zero on drift. Wired into pre-commit + CI so editing image.yaml's
// extraKernelArgs/systemExtensions without regenerating the pin (which silently
// boots the old schematic — e.g. losing lockdown=integrity) fails fast.
const CHECK_MODE = Bun.argv.includes("--check");

const SCHEMATIC_ID_PATTERN = /^[a-f0-9]{64}$/;

// Validate the Image Factory response without pulling in a schema library, so
// the script stays dependency-free and runs in the CI quality container (which
// does not install node_modules). This intentionally uses manual typeof guards
// instead of Zod (contrary to homelab AGENTS.md) because Zod is a node_modules
// dep and this script must run without `bun install` in the quality container.
function parseSchematicId(body: unknown): string {
  if (
    typeof body === "object" &&
    body !== null &&
    "id" in body &&
    typeof body.id === "string" &&
    SCHEMATIC_ID_PATTERN.test(body.id)
  ) {
    return body.id;
  }
  throw new Error(
    `Image Factory returned an unexpected schematic response: ${JSON.stringify(body)}`,
  );
}

const IMAGE_REPO = "metal-installer-secureboot";
const IMAGE_REF_PATTERN = new RegExp(
  `${IMAGE_REPO}/([a-f0-9]{64}):(v[0-9]+\\.[0-9]+\\.[0-9]+)@(sha256:[a-f0-9]{64})`,
);

async function fetchSchematicId(schematic: string): Promise<string> {
  console.log("Submitting schematic to Image Factory...");
  const response = await fetch("https://factory.talos.dev/schematics", {
    method: "POST",
    body: schematic,
  });
  if (!response.ok) {
    throw new Error(`Image Factory returned ${String(response.status)}`);
  }
  return parseSchematicId(await response.json());
}

// The installer image in patches/image.yaml is pinned by digest. Registries
// resolve by digest when both tag and digest are present, so after a schematic
// change the digest MUST be refreshed too — otherwise the reference silently
// keeps pointing at the old image.
async function fetchImageDigest(
  schematicId: string,
  version: string,
): Promise<string> {
  const url = `https://factory.talos.dev/v2/${IMAGE_REPO}/${schematicId}/manifests/${version}`;
  const response = await fetch(url, {
    method: "HEAD",
    headers: {
      Accept:
        "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json",
    },
  });
  if (!response.ok) {
    throw new Error(
      `Image Factory registry returned ${String(response.status)} for ${url}`,
    );
  }
  const digest = response.headers.get("docker-content-digest");
  if (digest === null || !/^sha256:[a-f0-9]{64}$/.test(digest)) {
    throw new Error(
      `Missing or malformed Docker-Content-Digest header for ${url} (got: ${String(digest)})`,
    );
  }
  return digest;
}

async function processNode(node: (typeof NODES)[number]): Promise<boolean> {
  const schematic = await Bun.file(node.schematicFile).text();
  const newId = await fetchSchematicId(schematic);
  console.log(`[${node.name}] schematic ID: ${newId}`);

  const patchContent = await Bun.file(node.patchFile).text();
  const refMatch = patchContent.match(IMAGE_REF_PATTERN);
  if (refMatch === null) {
    throw new Error(
      `Could not find existing <id>:<version>@<digest> image reference in ${node.patchFile}`,
    );
  }
  const [, oldId, version, oldDigest] = refMatch;
  if (oldId === undefined || version === undefined || oldDigest === undefined) {
    throw new Error(`Malformed image reference match in ${node.patchFile}`);
  }

  const newDigest = await fetchImageDigest(newId, version);
  console.log(`[${node.name}] installer digest for ${version}: ${newDigest}`);

  if (oldId === newId && oldDigest === newDigest) {
    console.log(
      CHECK_MODE
        ? `✓ [${node.name}] pinned Talos installer is in sync with its image.yaml`
        : `[${node.name}] image ID and digest unchanged, nothing to update`,
    );
    return true;
  }

  if (CHECK_MODE) {
    console.error(
      [
        `✗ [${node.name}] Talos installer pin is OUT OF SYNC with its image.yaml.`,
        "",
        `  pinned   (${node.patchFile}): ${oldId}@${oldDigest}`,
        `  expected (${node.schematicFile}): ${newId}@${newDigest}`,
        "",
        "The schematic source changed but the pinned installer reference was",
        "not regenerated, so the node would boot a stale schematic (e.g.",
        "dropping extraKernelArgs like lockdown=integrity). Regenerate with:",
        "",
        "  bun packages/homelab/src/talos/update-image-id.ts",
        "",
        "then commit the updated patch file(s) and README.md.",
      ].join("\n"),
    );
    return false;
  }

  console.log(`[${node.name}] old schematic ID: ${oldId}`);
  console.log(`[${node.name}] updating files...`);

  await Bun.write(
    node.patchFile,
    patchContent.replaceAll(oldId, newId).replaceAll(oldDigest, newDigest),
  );
  console.log(`  Updated: ${node.patchFile}`);

  // The repo README embeds torvalds' schematic id; replaceAll is a no-op for
  // nodes whose id does not appear there.
  const readmeContent = await Bun.file(readmeFile).text();
  await Bun.write(readmeFile, readmeContent.replaceAll(oldId, newId));

  console.log(
    `[${node.name}] done! New image: ${IMAGE_REPO}/${newId}:${version}@${newDigest}`,
  );
  return true;
}

async function main() {
  let ok = true;
  for (const node of NODES) {
    ok = (await processNode(node)) && ok;
  }
  if (!ok) {
    process.exit(1);
  }
}

await main();
