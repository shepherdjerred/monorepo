import { chmod, mkdir, writeFile } from "node:fs/promises";
import addonText from "#capture/brim_capture.py" with { type: "text" };
import {
  addonRoutes,
  allowHostPattern,
  interceptedHosts,
  type CaptureCli,
} from "./clis.ts";
import type { BrimCapturePaths } from "./paths.ts";

/**
 * The capture engine is a pinned mitmproxy `mitmdump`, run through `uvx` so
 * the exact version is fetched once into uv's cache and never upgraded by a
 * `uv tool upgrade` or `brew upgrade`. `uv` itself comes from the Brewfile.
 */
// renovate: datasource=pypi depName=mitmproxy
export const MITMPROXY_VERSION = "12.2.1";
/** mitmproxy 12 needs Python 3.12+; pinning keeps uv from picking a newer one. */
export const CAPTURE_PYTHON_VERSION = "3.13";

/**
 * Writes the addon where mitmdump loads it. The source is embedded in the
 * binary, so the installed `brim` needs no source tree.
 */
export async function writeAddon(paths: BrimCapturePaths): Promise<void> {
  await mkdir(paths.root, { recursive: true, mode: 0o700 });
  await chmod(paths.root, 0o700);
  await writeFile(paths.addon, addonText, { mode: 0o600 });
  await chmod(paths.addon, 0o600);
}

export function mitmdumpArgv(options: {
  readonly paths: BrimCapturePaths;
  readonly port: number;
  readonly clis: readonly CaptureCli[];
}): string[] {
  const { paths, port, clis } = options;
  const hosts = interceptedHosts(clis);
  if (hosts.length === 0) {
    throw new Error("brim.capture.clis is empty; there is nothing to capture.");
  }
  return [
    "uvx",
    "--python",
    CAPTURE_PYTHON_VERSION,
    "--from",
    `mitmproxy==${MITMPROXY_VERSION}`,
    "mitmdump",
    "--listen-host",
    "127.0.0.1",
    "--listen-port",
    String(port),
    "--set",
    `confdir=${paths.confDir}`,
    // Leaf certificates carry only the requested name. Copying the upstream
    // certificate's SANs would put names outside the CA's nameConstraints
    // into the leaf, and every constraint-checking client would reject it.
    "--set",
    "upstream_cert=false",
    ...hosts.flatMap((host) => ["--allow-hosts", allowHostPattern(host)]),
    "--set",
    "flow_detail=0",
    "--set",
    "termlog_verbosity=warn",
    "-s",
    paths.addon,
    "--set",
    `brim_capture_spool=${paths.spoolDir}`,
    "--set",
    `brim_capture_routes=${JSON.stringify(addonRoutes(clis))}`,
  ];
}

async function connects(port: number): Promise<boolean> {
  try {
    const socket = await Bun.connect({
      hostname: "127.0.0.1",
      port,
      socket: {
        data() {
          // The proxy says nothing until asked; nothing to read.
        },
      },
    });
    socket.end();
    return true;
  } catch {
    return false;
  }
}

/** True when something accepts TCP connections on the loopback port. */
export async function proxyListening(
  port: number,
  timeoutMs = 750,
): Promise<boolean> {
  const timeout = new Promise<boolean>((resolve) => {
    setTimeout(() => {
      resolve(false);
    }, timeoutMs);
  });
  return Promise.race([connects(port), timeout]);
}
