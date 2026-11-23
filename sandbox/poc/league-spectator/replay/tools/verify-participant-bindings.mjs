import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";
import { verifyReplayParticipantBindings } from "../replay-participant-bindings.mjs";
import { openReplay } from "../transport.mjs";

const [path, ...extra] = process.argv.slice(2);
if (!path || extra.length)
  throw Error("Usage: node verify-participant-bindings.mjs <replay.rofl>");
const bytes = readFileSync(path);
const replay = openReplay(new Uint8Array(bytes).buffer);
const outcome = verifyReplayParticipantBindings(replay, (stored, target) =>
  zstdDecompressSync(stored, { maxOutputLength: target.byteLength }),
);
console.log(
  JSON.stringify(
    {
      build: replay.build,
      protocol: replay.protocol,
      replaySha256: createHash("sha256").update(bytes).digest("hex"),
      verifiedBindings: outcome.verified.length,
      unresolvedContexts: outcome.unresolved.length,
      corroboratedAssists: outcome.assistEvents,
    },
    null,
    2,
  ),
);
