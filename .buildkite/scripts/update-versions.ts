/**
 * Update image version+digest entries in versions.ts.
 *
 * Usage: bun run update-versions.ts <versions-file> <version> [key=digest ...]
 *
 * Reads the TypeScript source, finds string assignments for the given keys,
 * and replaces their values with "version@sha256:digest".
 */

const [, , versionsFile, version, ...entries] = process.argv;
if (!versionsFile || !version) {
  console.error(
    "Usage: bun run update-versions.ts <file> <version> [key=digest ...]",
  );
  process.exit(1);
}

const digests = new Map<string, string>();
for (const entry of entries) {
  const eqIdx = entry.indexOf("=");
  if (eqIdx === -1) continue;
  const key = entry.slice(0, eqIdx);
  const digest = entry.slice(eqIdx + 1);
  if (key && digest) {
    digests.set(key, digest);
  }
}

if (digests.size === 0) {
  console.log("No digests provided, nothing to update");
  process.exit(0);
}

const source = await Bun.file(versionsFile).text();
const lines = source.split("\n");
let updated = 0;

for (let i = 0; i < lines.length; i++) {
  for (const [key, digest] of digests) {
    // Match lines like:  "shepherdjerred/birmel":
    //   followed by a value line like:    "1.1.137@sha256:abc...",
    if (lines[i].includes(`"${key}"`)) {
      // The value is on the next line (or same line after the colon)
      if (i + 1 < lines.length) {
        const valueLine = lines[i + 1];
        const indent = valueLine.match(/^(\s*)/)?.[1] ?? "    ";
        lines[i + 1] = `${indent}"${version}@${digest}",`;
        updated++;
        console.log(`Updated ${key}: ${version}@${digest}`);
      }
    }
  }
}

if (updated === 0) {
  console.error("No entries matched — check the key names");
  process.exit(1);
}

await Bun.write(versionsFile, lines.join("\n"));
console.log(`Updated ${updated} entries in ${versionsFile}`);
