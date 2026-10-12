import { versionParts } from "./release-manifest.ts";

export interface PublicRelease {
  version: string;
  expires: number;
  installer: { url: string; bytes: number; sha256: string };
}
export interface PublicationRecord {
  schema: 1;
  release: PublicRelease | null;
}

/** Publication data, written only after public artifact and manifest readback. */
export function parsePublicationRecord(raw: unknown): PublicationRecord {
  if (
    typeof raw !== "object" ||
    raw === null ||
    !("schema" in raw) ||
    raw.schema !== 1 ||
    !("release" in raw) ||
    Object.keys(raw).some((key) => key !== "schema" && key !== "release")
  )
    throw new Error("Invalid launcher publication record");
  if (raw.release === null) return { schema: 1, release: null };
  const release = raw.release;
  if (
    typeof release !== "object" ||
    release === null ||
    !("version" in release) ||
    typeof release.version !== "string" ||
    !("expires" in release) ||
    typeof release.expires !== "number" ||
    !Number.isSafeInteger(release.expires) ||
    release.expires <= 0 ||
    release.expires > 8_640_000_000_000 ||
    !("installer" in release) ||
    typeof release.installer !== "object" ||
    release.installer === null ||
    Object.keys(release).some(
      (key) => !["version", "expires", "installer"].includes(key),
    )
  )
    throw new Error("Invalid public launcher release");
  versionParts(release.version);
  const installer = release.installer;
  if (
    !("url" in installer) ||
    typeof installer.url !== "string" ||
    installer.url !==
      `https://glitter-boys.com/launcher/releases/${release.version}/glitter-boys_${release.version}_x64-setup.exe` ||
    !("bytes" in installer) ||
    typeof installer.bytes !== "number" ||
    !Number.isSafeInteger(installer.bytes) ||
    installer.bytes <= 0 ||
    installer.bytes > 128 * 1024 * 1024 ||
    !("sha256" in installer) ||
    typeof installer.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(installer.sha256) ||
    Object.keys(installer).some(
      (key) => !["url", "bytes", "sha256"].includes(key),
    )
  )
    throw new Error("Invalid public launcher installer");
  return {
    schema: 1,
    release: {
      version: release.version,
      expires: release.expires,
      installer: {
        url: installer.url,
        bytes: installer.bytes,
        sha256: installer.sha256,
      },
    },
  };
}
