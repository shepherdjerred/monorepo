import { createHash } from "node:crypto";
import path from "node:path";
import { torrentInfoHashes } from "#integrations/torrent.ts";

function string(value: string | Uint8Array): Buffer {
  const bytes =
    typeof value === "string" ? Buffer.from(value) : Buffer.from(value);
  return Buffer.concat([Buffer.from(`${String(bytes.length)}:`), bytes]);
}

/** Trackerless synthetic single-file torrent. Network isolation prevents outside peers. */
export async function localTorrent(filename: string) {
  const bytes = new Uint8Array(await Bun.file(filename).arrayBuffer());
  const pieces: Buffer[] = [];
  const pieceLength = 16_384;
  for (let offset = 0; offset < bytes.length; offset += pieceLength)
    pieces.push(
      createHash("sha1")
        .update(bytes.subarray(offset, offset + pieceLength))
        .digest(),
    );
  const info = Buffer.concat([
    Buffer.from("d6:lengthi" + String(bytes.length) + "e4:name"),
    string(path.basename(filename)),
    Buffer.from("12:piece lengthi" + String(pieceLength) + "e6:pieces"),
    string(Buffer.concat(pieces)),
    Buffer.from("e"),
  ]);
  const torrent = Buffer.concat([
    Buffer.from("d4:info"),
    info,
    Buffer.from("e"),
  ]);
  const hashes = torrentInfoHashes(torrent);
  if (hashes.v1 === null || hashes.v2 !== null)
    throw new Error("Synthetic v1 torrent identity invalid");
  return {
    bytes: new Uint8Array(torrent),
    infoHash: hashes.v1,
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
