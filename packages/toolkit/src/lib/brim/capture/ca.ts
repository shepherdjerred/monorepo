import { X509Certificate } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { BrimCapturePaths } from "./paths.ts";

/**
 * The dedicated capture CA.
 *
 * It is generated locally with the system `openssl` (LibreSSL on macOS),
 * lives only under `~/.toolkit/brim-capture/ca` (0700, key 0600), and carries
 * a critical X.509 `nameConstraints` extension that permits only the hosts a
 * CLI route can intercept. A leaked key therefore cannot mint a certificate
 * any verifier accepts for another name. It is never added to a keychain:
 * each CLI trusts it through its own environment variable.
 */

const CA_VALIDITY_DAYS = 825;
/** Regenerate this long before expiry so a running session never sees it lapse. */
const RENEW_BEFORE_MS = 30 * 24 * 60 * 60 * 1000;
const SUBJECT = "/CN=Brim capture CA (local, name-constrained)/O=brim capture";
const SYSTEM_ROOTS_KEYCHAIN =
  "/System/Library/Keychains/SystemRootCertificates.keychain";

export type CommandRunner = (
  argv: readonly string[],
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

export const runCommand: CommandRunner = async (argv) => {
  const child = Bun.spawn([...argv], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
};

async function mustRun(run: CommandRunner, argv: readonly string[]) {
  const result = await run(argv);
  if (result.exitCode !== 0) {
    throw new Error(
      `${argv[0] ?? "command"} failed (${String(result.exitCode)}): ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
  return result.stdout;
}

/** The OpenSSL config for a CA limited to `hosts` (and their subdomains). */
export function caOpenSslConfig(hosts: readonly string[]): string {
  if (hosts.length === 0) {
    throw new Error("A capture CA needs at least one permitted host.");
  }
  for (const host of hosts) {
    if (!/^[a-z0-9.-]+$/.test(host)) {
      throw new Error(`Refusing an unusual capture host name: ${host}`);
    }
  }
  const permitted = hosts.map((host) => `permitted;DNS:${host}`).join(",");
  return `[req]
distinguished_name = dn
prompt = no
[dn]
[v3_ca]
basicConstraints = critical,CA:TRUE,pathlen:0
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
nameConstraints = critical,${permitted}
`;
}

export type CaStatus = {
  readonly present: boolean;
  readonly notAfter: string | null;
  readonly hosts: readonly string[];
  /** False when missing, expiring, or constrained to a different host set. */
  readonly current: boolean;
};

function hostsFile(paths: BrimCapturePaths): string {
  return path.join(path.dirname(paths.caCert), "hosts.json");
}

export async function captureCaStatus(
  paths: BrimCapturePaths,
  hosts: readonly string[],
  now = new Date(),
): Promise<CaStatus> {
  const certFile = Bun.file(paths.caCert);
  if (!(await certFile.exists()) || !(await Bun.file(paths.caKey).exists())) {
    return { present: false, notAfter: null, hosts: [], current: false };
  }
  const certificate = new X509Certificate(await certFile.text());
  const notAfter = new Date(certificate.validTo);
  const hostsPath = hostsFile(paths);
  const constrained = (await Bun.file(hostsPath).exists())
    ? z.array(z.string()).parse(JSON.parse(await readFile(hostsPath, "utf8")))
    : [];
  const sameHosts =
    constrained.length === hosts.length &&
    constrained.every((host, index) => host === hosts[index]);
  return {
    present: true,
    notAfter: notAfter.toISOString(),
    hosts: constrained,
    current: sameHosts && notAfter.getTime() - now.getTime() > RENEW_BEFORE_MS,
  };
}

async function writePrivate(target: string, contents: string): Promise<void> {
  const temporary = `${target}.${String(process.pid)}.tmp`;
  await writeFile(temporary, contents, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, target);
}

/**
 * Generates the CA when it is missing, near expiry, or constrained to a
 * different host set, then (re)writes mitmproxy's confdir copy and the
 * `SSL_CERT_FILE` bundle. Returns true when a new CA was generated: CLIs
 * started before then must be restarted to trust it.
 */
export async function ensureCaptureCa(options: {
  readonly paths: BrimCapturePaths;
  readonly hosts: readonly string[];
  readonly run?: CommandRunner;
  /** PEM roots for the bundle; the macOS system roots by default. */
  readonly systemRoots?: () => Promise<string>;
  readonly now?: Date;
}): Promise<boolean> {
  const { paths, hosts } = options;
  const run = options.run ?? runCommand;
  const caDir = path.dirname(paths.caCert);
  for (const dir of [paths.root, caDir, paths.confDir]) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700);
  }
  const status = await captureCaStatus(paths, hosts, options.now);
  let generated = false;
  if (!status.current) {
    const config = path.join(caDir, "openssl.cnf");
    const keyTemporary = path.join(caDir, "capture-ca.key.tmp");
    const certTemporary = path.join(caDir, "capture-ca.pem.tmp");
    await writeFile(config, caOpenSslConfig(hosts), { mode: 0o600 });
    // openssl keeps an existing file's mode, so the key is never readable by
    // anyone else, even for a moment.
    await writeFile(keyTemporary, "", { mode: 0o600 });
    await chmod(keyTemporary, 0o600);
    try {
      await mustRun(run, [
        "openssl",
        "req",
        "-x509",
        "-new",
        "-nodes",
        "-newkey",
        "rsa:2048",
        "-sha256",
        "-days",
        String(CA_VALIDITY_DAYS),
        "-subj",
        SUBJECT,
        "-config",
        config,
        "-extensions",
        "v3_ca",
        "-keyout",
        keyTemporary,
        "-out",
        certTemporary,
      ]);
      await chmod(keyTemporary, 0o600);
      await rename(keyTemporary, paths.caKey);
      await rename(certTemporary, paths.caCert);
      await writePrivate(hostsFile(paths), `${JSON.stringify(hosts)}\n`);
    } finally {
      await rm(config, { force: true });
      await rm(keyTemporary, { force: true });
      await rm(certTemporary, { force: true });
    }
    generated = true;
  }
  const key = await readFile(paths.caKey, "utf8");
  const cert = await readFile(paths.caCert, "utf8");
  await writePrivate(
    path.join(paths.confDir, "mitmproxy-ca.pem"),
    `${key.trimEnd()}\n${cert.trimEnd()}\n`,
  );
  // mitmproxy derives these from mitmproxy-ca.pem only when they are absent.
  for (const stale of [
    "mitmproxy-ca-cert.pem",
    "mitmproxy-ca-cert.cer",
    "mitmproxy-ca-cert.p12",
    "mitmproxy-ca.p12",
  ]) {
    await rm(path.join(paths.confDir, stale), { force: true });
  }
  const roots = await (options.systemRoots ?? (() => macosSystemRoots(run)))();
  if (!roots.includes("-----BEGIN CERTIFICATE-----")) {
    throw new Error("The system root store returned no certificates.");
  }
  await writePrivate(paths.bundle, `${roots.trimEnd()}\n${cert.trimEnd()}\n`);
  return generated;
}

/** Reads the macOS system roots; never touches a writable keychain. */
export async function macosSystemRoots(run: CommandRunner): Promise<string> {
  return mustRun(run, [
    "/usr/bin/security",
    "find-certificate",
    "-a",
    "-p",
    SYSTEM_ROOTS_KEYCHAIN,
  ]);
}
