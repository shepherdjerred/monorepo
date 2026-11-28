import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { readLaneMinionHealthPrefix } from "../../../../../../packages/scout-for-lol/packages/replay/src/observations/replay-lane-minion-health.mjs";
import { recordedEntityReplication } from "./recorded-champion-replication.mjs";

const [archive, replay, opening, output, ...extra] = process.argv.slice(2);
assert.ok(
  output && extra.length === 0,
  "Usage: bun audit-mayhem-bloom-turret-health.mjs <archived client> <replay> <native opening receipt> <new census.json>",
);
const [binary, rawReplay, openingBytes] = await Promise.all(
  [archive, replay, opening].map((path) => readFile(path)),
);
assert.equal(
  Bun.CryptoHasher.hash("sha256", openingBytes, "hex"),
  "94d19a7c8ac014bab45552f533cb31adbacc9d2abe33c028e29078009d796f16",
);
const { replaySha256, bindings } = JSON.parse(openingBytes.toString("utf8"));
const replication = recordedEntityReplication(
  binary,
  rawReplay,
  { build: "16.23.841.8428", protocol: "8bbfcd5af2bc92db", replaySha256 },
  bindings.map(({ context }) => context),
  {
    allowCurrentBuild: true,
    includeSnapshots: true,
    accepts: (group, mask) => group === 32 && (mask & 3) !== 0,
  },
);
// Turrets use the same leading float encoding as lane minions. The native
// turret oracle independently verifies that ABI and the getter values.
const groups = [...replication.read()].map(({ bytes, ...group }) => ({
  ...group,
  ...readLaneMinionHealthPrefix(group.fieldMask, bytes),
  bytes: bytes.toString("hex"),
}));
assert.equal(groups.length, 819);
await writeFile(
  output,
  JSON.stringify({ identity: replication.identity, groups }, null, 2),
  { flag: "wx" },
);
