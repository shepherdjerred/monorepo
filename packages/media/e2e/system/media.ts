import path from "node:path";
import { command, until } from "./process.ts";
import { localTorrent } from "./torrent.ts";
import type { startLocalQbittorrent } from "./qbittorrent.ts";

export const SYSTEM_RELEASE = "Synthetic.System.Movie.2020.WEB-DL.1080p.H264";

/** Generate the input ourselves; no household media or outside peers are used. */
export async function generateSyntheticMovie(directory: string) {
  const filename = `${SYSTEM_RELEASE}.mkv`;
  const sourcePath = path.join(directory, filename);
  await command([
    "ffmpeg",
    "-nostdin",
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:size=1920x1080:rate=24",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-t",
    "2",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-threads",
    "1",
    "-c:a",
    "aac",
    "-metadata:s:a:0",
    "language=eng",
    sourcePath,
  ]);
  const torrent = await localTorrent(sourcePath);
  return { ...torrent, filename, sourcePath };
}

export async function seedSyntheticMovie(
  peers: Awaited<ReturnType<typeof startLocalQbittorrent>>,
  torrent: Awaited<ReturnType<typeof generateSyntheticMovie>>,
) {
  const form = new FormData();
  form.set("torrents", new Blob([torrent.bytes]), "synthetic.torrent");
  form.set("savepath", "/downloads");
  form.set("skip_checking", "false");
  const response = await peers.seed.api("/api/v2/torrents/add", form);
  const added: unknown = await response.json();
  await Bun.write(
    path.join(peers.seedRoot, "seed-add.json"),
    JSON.stringify(added),
  );
  await peers.seed.client.login();
  let observed: Awaited<ReturnType<typeof peers.seed.client.observe>> = null;
  try {
    await until("verified local seed", async () => {
      observed = await peers.seed.client.observe(torrent.infoHash);
      return observed?.progress === 1 &&
        ["uploading", "stalledUP"].includes(observed.state)
        ? observed
        : null;
    });
  } finally {
    await Bun.write(
      path.join(peers.seedRoot, "seed-observation.json"),
      JSON.stringify(observed, null, 2),
    );
  }
  return { ...torrent, seedAdd: added };
}

export async function connectLocalPeer(
  peers: Awaited<ReturnType<typeof startLocalQbittorrent>>,
  hash: string,
) {
  await peers.download.api(
    "/api/v2/torrents/addPeers",
    new URLSearchParams({
      hashes: hash,
      peers: `${peers.seed.ip}:6881`,
    }),
  );
}
