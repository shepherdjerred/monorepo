import { pbkdf2Sync, randomBytes } from "node:crypto";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import catalog from "@shepherdjerred/version-catalog/catalog.json" with { type: "json" };
import { QbittorrentClient } from "#integrations/qbittorrent.ts";
import { command, until } from "./process.ts";
import { containerHttp } from "./container-http.ts";
import type { FetchTransport } from "#integrations/http.ts";

const labelKey = "media.system-acceptance";
const syntheticUsername = "system-fixture";
const syntheticPassword = "isolated-qbit-fixture-only";

/** A separate authenticated wire client for controlling only this disposable peer. */
async function control(origin: string, transport: FetchTransport) {
  const login = await transport(new URL(`${origin}/api/v2/auth/login`), {
    method: "POST",
    headers: { Origin: origin },
    body: new URLSearchParams({
      username: syntheticUsername,
      password: syntheticPassword,
    }),
  });
  if (!login.ok) throw new Error("Synthetic qBittorrent login failed");
  const cookie = login.headers.getSetCookie()[0]?.split(";")[0];
  if (cookie === undefined)
    throw new Error("Synthetic qBittorrent session missing");
  return async (route: string, body?: FormData | URLSearchParams) => {
    if (!/^\/api\/v2\/[a-zA-Z/]+$/.test(route))
      throw new Error("Invalid peer API route");
    const response = await transport(new URL(origin + route), {
      method: body === undefined ? "GET" : "POST",
      headers: { Origin: origin, Cookie: cookie },
      ...(body === undefined ? {} : { body }),
    });
    if (!response.ok)
      throw new Error(`Synthetic peer API failed: ${String(response.status)}`);
    return response;
  };
}

/** Both peers are on an internal-only network, without host-published ports.
 * Caller owns the fresh scratch directory. Cleanup checks exact ownership labels.
 */
export async function startLocalQbittorrent(
  root: string,
  seedFiles: readonly string[] = [],
) {
  const instance = crypto.randomUUID();
  const network = `media-system-${instance}`;
  const names: string[] = [];
  const version = catalog.entries.find(
    (entry) => entry.name === "linuxserver/qbittorrent",
  );
  if (version === undefined)
    throw new Error("Catalog qBittorrent version missing");
  const expectedVersion = `v${version.value.split("@")[0] ?? ""}`;
  const image = `ghcr.io/linuxserver/qbittorrent:${version.value}`;
  const downloadRoot = path.join(root, "downloads");
  const seedRoot = path.join(root, "seed");
  await mkdir(downloadRoot);
  await mkdir(seedRoot);
  for (const filename of seedFiles)
    await copyFile(filename, path.join(seedRoot, path.basename(filename)));
  await command([
    "docker",
    "network",
    "create",
    "--internal",
    "--label",
    `${labelKey}=${instance}`,
    network,
  ]);
  async function close() {
    for (const name of names.toReversed()) {
      const owner = await command([
        "docker",
        "inspect",
        "--format",
        `{{ index .Config.Labels "${labelKey}" }}`,
        name,
      ]);
      if (owner !== instance)
        throw new Error("Refusing to remove a foreign acceptance container");
      await command(["docker", "rm", "--force", name]);
    }
    const owner = await command([
      "docker",
      "network",
      "inspect",
      "--format",
      `{{ index .Labels "${labelKey}" }}`,
      network,
    ]);
    if (owner !== instance)
      throw new Error("Refusing to remove a foreign acceptance network");
    await command(["docker", "network", "rm", network]);
  }
  async function peer(kind: "seed" | "download") {
    const configRoot = path.join(root, `${kind}-config`);
    const config = path.join(configRoot, "qBittorrent", "config");
    await mkdir(config, { recursive: true });
    const salt = randomBytes(16);
    const hash = pbkdf2Sync(syntheticPassword, salt, 100_000, 64, "sha512");
    // Fixture-only credentials; production credentials/configuration are never read.
    await Bun.write(
      path.join(config, "qBittorrent.conf"),
      [
        "[LegalNotice]",
        "Accepted=true",
        "[BitTorrent]",
        String.raw`Session\DHTEnabled=false`,
        String.raw`Session\PeXEnabled=false`,
        String.raw`Session\LSDEnabled=false`,
        String.raw`Session\Port=6881`,
        "[Network]",
        "PortForwardingEnabled=false",
        "[Preferences]",
        String.raw`WebUI\Username=${syntheticUsername}`,
        String.raw`WebUI\Password_PBKDF2="@ByteArray(${salt.toString("base64")}:${hash.toString("base64")})"`,
        String.raw`WebUI\LocalHostAuth=true`,
        String.raw`WebUI\Address=*`,
        String.raw`WebUI\Port=8080`,
        "",
      ].join("\n"),
    );
    const name = `${network}-${kind}`;
    await command([
      "docker",
      "run",
      "--detach",
      "--name",
      name,
      "--label",
      `${labelKey}=${instance}`,
      "--network",
      network,
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--memory",
      "512m",
      "--cpus",
      "1",
      "--tmpfs",
      "/tmp:rw,nosuid,nodev,size=64m",
      "--mount",
      `type=bind,source=${configRoot},target=/config`,
      "--mount",
      `type=bind,source=${kind === "seed" ? seedRoot : downloadRoot},target=/downloads`,
      "--entrypoint",
      "/app/qbittorrent-nox",
      image,
      "--profile=/config",
      "--webui-port=8080",
      "--confirm-legal-notice",
    ]);
    names.push(name);
    await command(["docker", "exec", name, "which", "curl"]);
    const origin = "http://127.0.0.1:8080";
    const transport = containerHttp(name);
    await until("qBittorrent listener", async () => {
      try {
        const response = await transport(
          new URL(`${origin}/api/v2/app/version`),
          {
            signal: AbortSignal.timeout(500),
          },
        );
        return response.status === 403 ? true : null;
      } catch {
        return null;
      }
    });
    const api = await control(origin, transport);
    const versionResponse = await api("/api/v2/app/version");
    const actualVersion = await versionResponse.text();
    if (actualVersion !== expectedVersion)
      throw new Error("Acceptance peer differs from catalog qBittorrent");
    const client = new QbittorrentClient(
      {
        baseUrl: origin,
        username: syntheticUsername,
        password: syntheticPassword,
        category: "media",
      },
      transport,
    );
    const ip = z
      .ipv4()
      .parse(
        await command([
          "docker",
          "inspect",
          "--format",
          `{{ (index .NetworkSettings.Networks "${network}").IPAddress }}`,
          name,
        ]),
      );
    return { api, client, origin, ip };
  }
  try {
    const seed = await peer("seed");
    const download = await peer("download");
    return { seed, download, downloadRoot, seedRoot, image, close };
  } catch (error) {
    await close();
    throw error;
  }
}
