#!/usr/bin/env bun

import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const schematicFile = join(scriptDir, "image.yaml");
const patchFile = join(scriptDir, "patches/image.yaml");
const readmeFile = join(scriptDir, "../../README.md");

const SchematicResponseSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
});

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
  return SchematicResponseSchema.parse(await response.json()).id;
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

async function main() {
  const schematic = await Bun.file(schematicFile).text();
  const newId = await fetchSchematicId(schematic);
  console.log(`New schematic ID: ${newId}`);

  const patchContent = await Bun.file(patchFile).text();
  const refMatch = patchContent.match(IMAGE_REF_PATTERN);
  if (refMatch === null) {
    throw new Error(
      `Could not find existing <id>:<version>@<digest> image reference in ${patchFile}`,
    );
  }
  const [, oldId, version, oldDigest] = refMatch;
  if (oldId === undefined || version === undefined || oldDigest === undefined) {
    throw new Error(`Malformed image reference match in ${patchFile}`);
  }

  const newDigest = await fetchImageDigest(newId, version);
  console.log(`Installer digest for ${version}: ${newDigest}`);

  if (oldId === newId && oldDigest === newDigest) {
    console.log("Image ID and digest unchanged, nothing to update");
    return;
  }

  console.log(`Old schematic ID: ${oldId}`);
  console.log("Updating files...");

  await Bun.write(
    patchFile,
    patchContent.replaceAll(oldId, newId).replaceAll(oldDigest, newDigest),
  );
  console.log(`  Updated: ${patchFile}`);

  const readmeContent = await Bun.file(readmeFile).text();
  await Bun.write(readmeFile, readmeContent.replaceAll(oldId, newId));
  console.log(`  Updated: ${readmeFile}`);

  console.log(
    `Done! New image: ${IMAGE_REPO}/${newId}:${version}@${newDigest}`,
  );
}

await main();
