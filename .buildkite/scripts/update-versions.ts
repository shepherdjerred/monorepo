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

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Matches `"value"` (possibly with trailing comma) as the only content after whitespace on a line.
const VALUE_LINE_RE = /^(\s*)"[^"]*"(\s*,?\s*)$/;

for (let i = 0; i < lines.length; i++) {
  for (const [key, digest] of digests) {
    // Match lines containing the key as an exact match OR as a prefix with /beta suffix.
    // Digest keys come from catalog versionKey (e.g. "shepherdjerred/scout-for-lol").
    // versions.ts may have "/beta" suffix for deployment stages — we update the beta entry.
    const exactMatch = lines[i].includes(`"${key}"`);
    const betaMatch = lines[i].includes(`"${key}/beta"`);
    if (!exactMatch && !betaMatch) continue;
    const matchedKey = betaMatch ? `${key}/beta` : key;
    const newValue = `${version}@${digest}`;

    // Case 1: same-line entry — `"key": "value",`
    const sameLineRe = new RegExp(
      `("${escapeRegex(matchedKey)}"\\s*:\\s*)"[^"]*"(\\s*,?)`,
    );
    if (sameLineRe.test(lines[i])) {
      lines[i] = lines[i].replace(sameLineRe, `$1"${newValue}"$2`);
      updated++;
      console.log(`Updated ${matchedKey}: ${newValue}`);
      continue;
    }

    // Case 2: multi-line entry — key on this line, value on the next.
    // Validate the next line really is a string-value line before overwriting,
    // so we never clobber a closing brace or unrelated code.
    if (i + 1 >= lines.length) continue;
    const valueLine = lines[i + 1];
    const valueMatch = valueLine.match(VALUE_LINE_RE);
    if (!valueMatch) {
      console.error(
        `Refusing to update ${matchedKey}: line after key is not a string value: ${JSON.stringify(valueLine)}`,
      );
      process.exit(1);
    }
    const indent = valueMatch[1];
    lines[i + 1] = `${indent}"${newValue}",`;
    updated++;
    console.log(`Updated ${matchedKey}: ${newValue}`);
  }
}

if (updated === 0) {
  console.error("No entries matched — check the key names");
  process.exit(1);
}

await Bun.write(versionsFile, lines.join("\n"));
console.log(`Updated ${updated} entries in ${versionsFile}`);
