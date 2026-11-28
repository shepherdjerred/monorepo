import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createNativeRiftMissileLaunchReader } from "./native-rift-missile-launch-reader.mjs";

const [emulatorPath, profileDirectory, ...corpusPaths] = process.argv.slice(2);
assert.ok(
  emulatorPath && profileDirectory && corpusPaths.length,
  "Usage: bun verify-rift-missile-launch-reader.mjs EMULATOR PROFILE_DIRECTORY NATIVE_CORPUS ...",
);
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const [{ default: createEmulator }, profile, pages, reports, ...corpora] =
  await Promise.all([
    import(pathToFileURL(resolve(emulatorPath)).href),
    json(join(profileDirectory, "profile.json")),
    readFile(join(profileDirectory, "pages.bin")),
    json(join(profileDirectory, "reports.json")),
    ...corpusPaths.map(json),
  ]);
assert.equal(reports.length, corpora.length);
const reader = await createNativeRiftMissileLaunchReader(
  await createEmulator(),
  profile,
  pages,
);
try {
  const checks = [];
  const start = performance.now();
  let exercised = false;
  for (const [corpusIndex, { creation }] of corpora.entries()) {
    const native = reports[corpusIndex];
    const candidates = new Map(
      native.records.map(
        ({ creationIndex, nativeRecordedSourceStarts, ...record }) => [
          creationIndex,
          record,
        ],
      ),
    );
    assert.equal(candidates.size, native.records.length);
    for (const [index, [context, raw]] of creation.entries()) {
      const payload = Buffer.from(raw, "hex");
      const expected = candidates.get(index) ?? null;
      const actual = reader.decode(payload, context);
      assert.deepEqual(
        actual,
        expected,
        `Opcode 639 corpus ${corpusIndex}, body ${index}`,
      );
      if (actual === null || exercised) continue;
      exercised = true;
      assert.throws(
        () => reader.decode(payload, context ^ 1),
        /body and envelope disagree/,
      );
      assert.throws(
        () => reader.decode(payload.subarray(0, -1), context),
        /rejected packet body/,
      );
      assert.throws(
        () => reader.decode(Buffer.concat([payload, Buffer.of(0)]), context),
        /rejected packet body/,
      );
      // The archived reader's spell-key varint consumes these bytes for the
      // first retained launch. Its one-bit control keeps the packet valid and
      // changes only the requested missile spell identity.
      const keyOffset = payload.indexOf(Buffer.from("c93f5334", "hex"));
      assert.ok(keyOffset >= 0);
      const otherSpell = Uint8Array.from(payload);
      otherSpell[keyOffset] ^= 1;
      assert.equal(reader.decode(otherSpell, context), null);
      assert.deepEqual(reader.decode(payload, context), expected);
    }
    checks.push({
      bodies: creation.length,
      launches: candidates.size,
      owners: [
        ...new Set(native.records.map(({ sourceContext }) => sourceContext)),
      ],
    });
  }
  assert.ok(
    exercised,
    "Expected an original admitted launch for negative controls",
  );
  const corruptedPages = Uint8Array.from(pages);
  corruptedPages[0] ^= 1;
  await assert.rejects(
    createNativeRiftMissileLaunchReader(
      await createEmulator(),
      profile,
      corruptedPages,
    ),
    /Unsupported exact .* missile launch image/,
  );
  console.log(
    JSON.stringify({
      checks,
      profilePages: profile.pages.length,
      elapsedMilliseconds: Math.round(performance.now() - start),
    }),
  );
} finally {
  reader.close();
}
