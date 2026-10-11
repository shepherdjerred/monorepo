import {
  createHash,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";

export interface Envelope {
  payload: string;
  signature: string;
}
export interface Release {
  schema: 1;
  version: string;
  channel: string;
  target: "x86_64-pc-windows-msvc";
  minimum_bootstrap: number;
  expires: number;
  expanded_bytes: number;
  executable_sha256: string;
  artifact: {
    file: "launcher.zip";
    url: string;
    bytes: number;
    sha256: string;
  };
}
export const sha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export function versionParts(value: string): number[] {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value))
    throw new Error(
      "Release version must have three numeric components without leading zeroes",
    );
  const parts = value.split(".").map(Number);
  if (!parts.every(Number.isSafeInteger))
    throw new Error("Release version is too large");
  return parts;
}
export function compareVersions(a: string, b: string): number {
  const left = versionParts(a),
    right = versionParts(b);
  for (let i = 0; i < 3; i++) {
    const difference = left[i]! - right[i]!;
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}
export function signRelease(release: Release, key: KeyObject): Envelope {
  const payload = JSON.stringify(release);
  return {
    payload,
    signature: sign(
      null,
      Buffer.from(`glitter-boys-release-v1\n${payload}`),
      key,
    ).toString("hex"),
  };
}
export function verifyPublication(
  raw: unknown,
  keys: string[],
  channel: string,
  allowExpired = false,
): Release {
  if (
    typeof raw !== "object" ||
    raw === null ||
    !("payload" in raw) ||
    typeof raw.payload !== "string" ||
    Buffer.byteLength(raw.payload) > 16 * 1024 ||
    !("signature" in raw) ||
    typeof raw.signature !== "string" ||
    !/^[a-f0-9]{128}$/i.test(raw.signature) ||
    Object.keys(raw).some((key) => key !== "payload" && key !== "signature")
  )
    throw new Error("Release envelope is invalid");
  const envelope = { payload: raw.payload, signature: raw.signature };
  const authenticated = keys.some((key) =>
    verify(
      null,
      Buffer.from(`glitter-boys-release-v1\n${envelope.payload}`),
      createPublicKey({
        key: Buffer.concat([
          Buffer.from("302a300506032b6570032100", "hex"),
          Buffer.from(key, "hex"),
        ]),
        format: "der",
        type: "spki",
      }),
      Buffer.from(envelope.signature, "hex"),
    ),
  );
  if (!authenticated) throw new Error("Release signature is invalid");
  const release = JSON.parse(envelope.payload) as Release;
  versionParts(release.version);
  const fields = [
    "schema",
    "version",
    "channel",
    "target",
    "minimum_bootstrap",
    "expires",
    "expanded_bytes",
    "executable_sha256",
    "artifact",
  ];
  if (
    Object.keys(release).some((key) => !fields.includes(key)) ||
    release.schema !== 1 ||
    release.channel !== channel ||
    release.target !== "x86_64-pc-windows-msvc" ||
    !Number.isSafeInteger(release.minimum_bootstrap) ||
    release.minimum_bootstrap < 0 ||
    release.minimum_bootstrap > 1 ||
    !Number.isSafeInteger(release.expires) ||
    release.expires <= 0 ||
    !Number.isSafeInteger(release.expanded_bytes) ||
    release.expanded_bytes <= 0 ||
    release.expanded_bytes > 512 * 1024 * 1024 ||
    !/^[a-f0-9]{64}$/i.test(release.executable_sha256) ||
    !release.artifact ||
    Object.keys(release.artifact).some(
      (key) => !["file", "url", "bytes", "sha256"].includes(key),
    ) ||
    release.artifact.file !== "launcher.zip" ||
    !Number.isSafeInteger(release.artifact.bytes) ||
    release.artifact.bytes <= 0 ||
    release.artifact.bytes > 256 * 1024 * 1024 ||
    !/^[a-f0-9]{64}$/i.test(release.artifact.sha256) ||
    (!allowExpired && release.expires <= Date.now() / 1000) ||
    release.artifact.url !==
      `https://glitter-boys.com/launcher/releases/${release.version}/launcher.zip`
  )
    throw new Error("Release metadata is invalid or expired");
  return release;
}
export function renewManifest(
  envelope: Envelope,
  keys: string[],
  channel: string,
  key: KeyObject,
): Envelope {
  const release = verifyPublication(envelope, keys, channel, true);
  const renewed = signRelease(
    { ...release, expires: Math.floor(Date.now() / 1000) + 90 * 86400 },
    key,
  );
  verifyPublication(renewed, keys, channel);
  return renewed;
}
