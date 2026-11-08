import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startLocalQbittorrent } from "./qbittorrent.ts";
import {
  connectLocalPeer,
  generateSyntheticMovie,
  seedSyntheticMovie,
} from "./media.ts";
import { until } from "./process.ts";

const root = await realpath(
  await mkdtemp(path.join(tmpdir(), "media-system-peer-")),
);
const generated = path.join(root, "generated");
await mkdir(generated);
const movie = await generateSyntheticMovie(generated);
const peers = await startLocalQbittorrent(root, [movie.sourcePath]);
try {
  const fixture = await seedSyntheticMovie(peers, movie);
  const operationId = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  const input = {
    operationId,
    attemptId,
    hash: fixture.infoHash,
    bytes: fixture.bytes,
    savePath: `/downloads/media/${attemptId}`,
  };
  await peers.download.client.login();
  const first = await peers.download.client.submitTorrent(input);
  if (first !== "accepted")
    throw new Error("First real peer submission was not accepted");
  const replay = await peers.download.client.submitTorrent(input);
  if (replay !== "already-present")
    throw new Error("Exact real peer retry duplicated submission");
  await connectLocalPeer(peers, fixture.infoHash);
  const observation = await until("real local peer transfer", async () => {
    const observed = await peers.download.client.observe(fixture.infoHash);
    return observed?.progress === 1 ? observed : null;
  });
  peers.download.client.validateOwnership(observation, input);
  const files = await peers.download.client.files(observation.hash);
  if (
    files.length !== 1 ||
    files[0]?.name !== fixture.filename ||
    files[0].progress !== 1
  )
    throw new Error("Transferred torrent member differs from generated input");
  const target = path.join(
    peers.downloadRoot,
    "media",
    attemptId,
    fixture.filename,
  );
  const bytes = new Uint8Array(await Bun.file(target).arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== fixture.sha256)
    throw new Error("Transferred bytes differ from independent input checksum");
  const result = {
    image: peers.image,
    first,
    replay,
    bytes: bytes.byteLength,
    sha256: fixture.sha256,
    observation,
    files,
    evidence:
      "real qBittorrent peers and wire adapter; not HTTP/Temporal/Plex acceptance",
  };
  await Bun.write(
    path.join(root, "result.json"),
    JSON.stringify(result, null, 2),
  );
  process.stdout.write(
    JSON.stringify({ passed: true, root, bytes: bytes.byteLength }) + "\n",
  );
} finally {
  await peers.close();
}
