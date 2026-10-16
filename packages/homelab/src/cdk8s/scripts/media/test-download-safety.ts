import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { excludedMediaFileNames } from "homelab/src/media-download-policy.ts";
import versions from "@shepherdjerred/homelab/cdk8s/src/versions.ts";

// Disposable local peers exchange harmless text fixtures, never public torrents.
const image = `ghcr.io/linuxserver/qbittorrent:${versions["linuxserver/qbittorrent"]}`;
const runId = randomUUID().slice(0, 8);
const network = `media-safety-${runId}`;
const seed = `${network}-seed`;
const receiver = `${network}-receiver`;
const temporary = await mkdtemp(path.join(tmpdir(), "media-safety-canary-"));

async function command(args: string[], allowFailure = false) {
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0 && !allowFailure)
    throw new Error(`${String(args[0])} failed (${String(code)}): ${stderr}`);
  return stdout;
}

async function api(
  container: string,
  endpoint: string,
  values?: Record<string, string>,
) {
  return command([
    "docker",
    "exec",
    container,
    "curl",
    "-fsS",
    "--max-time",
    "10",
    `http://localhost:8080/api/v2/${endpoint}`,
    ...Object.entries(values ?? {}).flatMap(([key, value]) => [
      "--data-urlencode",
      `${key}=${value}`,
    ]),
  ]);
}

async function waitFor<T>(
  read: () => Promise<T>,
  ready: (value: T) => boolean,
  label: string,
) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const value = await read();
    if (ready(value)) return value;
    await Bun.sleep(500);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function string(value: string | Uint8Array) {
  const data =
    typeof value === "string" ? Buffer.from(value) : Buffer.from(value);
  return Buffer.concat([Buffer.from(`${String(data.length)}:`), data]);
}

function fixture(name: string) {
  const data = Buffer.alloc(65_536, 65); // Plain letter A; no executable payload.
  const pieces = createHash("sha1").update(data).digest();
  const info = Buffer.concat([
    Buffer.from(`d6:lengthi${String(data.length)}e4:name`),
    string(name),
    Buffer.from("12:piece lengthi65536e6:pieces"),
    string(pieces),
    Buffer.from("e"),
  ]);
  return {
    data,
    torrent: Buffer.concat([Buffer.from("d4:info"), info, Buffer.from("e")]),
    hash: createHash("sha1").update(info).digest("hex"),
  };
}

const ContentSchema = z.array(
  z.object({ name: z.string(), priority: z.number(), progress: z.number() }),
);
const created: string[] = [];
let networkCreated = false;
try {
  await command(["docker", "network", "create", network]);
  networkCreated = true;
  for (const container of [seed, receiver]) {
    const directory = path.join(temporary, container);
    await mkdir(path.join(directory, "qBittorrent"), { recursive: true });
    await mkdir(path.join(directory, "downloads"));
    await writeFile(
      path.join(directory, "qBittorrent", "qBittorrent.conf"),
      [
        "[LegalNotice]",
        "Accepted=true",
        "[Preferences]",
        String.raw`WebUI\LocalHostAuth=false`,
        String.raw`WebUI\ServerDomains=*`,
        "[BitTorrent]",
        String.raw`Session\Port=6881`,
        `ExcludedFileNamesEnabled=${container === receiver ? "true" : "false"}`,
        String.raw`Session\ExcludedFileNames=${excludedMediaFileNames}`,
        "",
      ].join("\n"),
    );
    created.push(container);
    await command([
      "docker",
      "run",
      "-d",
      "--name",
      container,
      "--network",
      network,
      "--memory",
      "256m",
      "--cpus",
      "1",
      "-v",
      `${directory}:/config`,
      "-e",
      "XDG_CONFIG_HOME=/config",
      "--entrypoint",
      "/app/qbittorrent-nox",
      image,
      "--confirm-legal-notice",
      "--webui-port=8080",
    ]);
    await waitFor(
      () =>
        command(
          [
            "docker",
            "exec",
            container,
            "curl",
            "-fsS",
            "http://localhost:8080/api/v2/app/version",
          ],
          true,
        ),
      (value) => value.startsWith("v5."),
      "qBittorrent startup",
    );
  }
  const seedInspection = await command([
    "docker",
    "inspect",
    "--format",
    "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
    seed,
  ]);
  const seedIp = seedInspection.trim();
  for (const magnet of [false, true]) {
    for (const dangerous of [false, true]) {
      const name = `harmless-${magnet ? "magnet" : "torrent"}.${dangerous ? "mkv.EXE" : "mkv"}`;
      const item = fixture(name);
      await writeFile(path.join(temporary, seed, "downloads", name), item.data);
      for (const container of [seed, receiver]) {
        await writeFile(
          path.join(temporary, container, `${name}.torrent`),
          item.torrent,
        );
      }
      await command([
        "docker",
        "exec",
        seed,
        "curl",
        "-fsS",
        "http://localhost:8080/api/v2/torrents/add",
        "-F",
        `torrents=@/config/${name}.torrent`,
        "-F",
        "savepath=/config/downloads",
        "-F",
        "skip_checking=true",
      ]);
      if (magnet) {
        await api(receiver, "torrents/add", {
          urls: `magnet:?xt=urn:btih:${item.hash}`,
          savepath: "/config/downloads",
        });
        await api(receiver, "torrents/addPeers", {
          hashes: item.hash,
          peers: `${seedIp}:6881`,
        });
      } else {
        await command([
          "docker",
          "exec",
          receiver,
          "curl",
          "-fsS",
          "http://localhost:8080/api/v2/torrents/add",
          "-F",
          `torrents=@/config/${name}.torrent`,
          "-F",
          "savepath=/config/downloads",
        ]);
        await api(receiver, "torrents/addPeers", {
          hashes: item.hash,
          peers: `${seedIp}:6881`,
        });
      }
      const content = await waitFor(
        async () =>
          ContentSchema.parse(
            JSON.parse(await api(receiver, `torrents/files?hash=${item.hash}`)),
          ),
        (files) => files.length > 0,
        "torrent metadata",
      );
      const [file] = content;
      assert.ok(file !== undefined);
      assert.equal(file.priority === 0, dangerous);
      if (dangerous) assert.equal(file.progress, 0);
      console.log(
        `${magnet ? "magnet" : "torrent"}: ${name}: priority=${String(file.priority)}, progress=${String(file.progress)} PASS`,
      );
    }
  }
} finally {
  for (const container of created)
    await command(["docker", "rm", "-f", container], true);
  if (networkCreated) await command(["docker", "network", "rm", network], true);
  await rm(temporary, { recursive: true });
}
