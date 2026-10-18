import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";
import { Unzip, UnzipInflate } from "fflate";
import type { UnzipFile } from "fflate";
import {
  forumBundlePolicy,
  ForumBundlePolicySchema,
} from "@shepherdjerred/ops-model/forum-bundle-policy.ts";
import { DeliveryError } from "#domain/error.ts";
import { zipDirectory, invalidZip } from "./zip-directory.ts";
import type { ZipEntry } from "./zip-directory.ts";

type Policy = typeof forumBundlePolicy;
function versionDeclaration(chunks: Uint8Array[], policy: Policy) {
  const code = Buffer.concat(chunks).toString("utf8"),
    versions = [
      ...code.matchAll(
        /\bpublic\s+static\s+\$version\s*=\s*(['"])(\d+\.\d+\.\d+)\1\s*;/gu,
      ),
    ];
  if (versions.length !== 1 || versions[0]?.[2] !== policy.xenforoVersion)
    throw new DeliveryError(
      "INVALID",
      "Licensed XenForo declaration does not match the reviewed version",
    );
}

function inspectFile(
  file: UnzipFile,
  expected: ZipEntry,
  policy: Policy,
  completed: Set<string>,
) {
  const digest = createHash("sha256"),
    version: Uint8Array[] = [];
  let checksum = 0,
    size = 0;
  file.ondata = (error, chunk, final) => {
    if (error !== null) invalidZip();
    size += chunk.length;
    if (
      size > expected.size ||
      (file.name === "src/XF.php" && size > 1024 * 1024)
    )
      invalidZip();
    checksum = crc32(chunk, checksum);
    digest.update(chunk);
    if (file.name === "src/XF.php") version.push(chunk);
    if (!final) return;
    if (size !== expected.size || checksum !== expected.crc) invalidZip();
    const hash = digest.digest("hex"),
      required = policy.vendorDependencies.find(
        (dependency) => dependency.path === file.name,
      );
    if (required !== undefined && hash !== required.sha256)
      throw new DeliveryError(
        "INVALID",
        "Licensed style archive does not match its reviewed dependency checksum",
      );
    if (file.name === "src/XF.php") versionDeclaration(version, policy);
    completed.add(file.name);
  };
}

/** Fully decompress/CRC-check every entry. Policy injection supports isolated tests; API always uses the reviewed policy. */
export async function verifyForumBundleZip(
  bytes: Uint8Array,
  reviewedPolicy: Policy = forumBundlePolicy,
): Promise<void> {
  const policy = ForumBundlePolicySchema.parse(reviewedPolicy),
    entries = zipDirectory(bytes);
  for (const name of [
    "src/XF.php",
    "src/XF/App.php",
    "index.php",
    "cmd.php",
    ...policy.vendorDependencies.map((dependency) => dependency.path),
  ])
    if (!entries.has(name)) invalidZip();
  if (entries.has("src/config.php"))
    throw new DeliveryError(
      "INVALID",
      "Licensed distribution must not contain installed production configuration",
    );
  const completed = new Set<string>();
  let failure: Error | undefined;
  const unzip = new Unzip((file) => {
    const expected = entries.get(file.name);
    if (expected === undefined || completed.has(file.name)) invalidZip();
    inspectFile(file, expected, policy, completed);
    const inspect = file.ondata;
    file.ondata = (...args) => {
      try {
        inspect(...args);
      } catch (error) {
        failure =
          error instanceof Error
            ? error
            : new DeliveryError("INVALID", "Corrupt licensed ZIP entry");
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    for (let offset = 0; offset < bytes.length; offset += 64 * 1024) {
      const end = Math.min(bytes.length, offset + 64 * 1024);
      unzip.push(bytes.subarray(offset, end), end === bytes.length);
      if (failure !== undefined) throw failure;
      if (offset % (1024 * 1024) === 0) await Bun.sleep(0);
    }
    if (completed.size !== entries.size) invalidZip();
  } catch (error) {
    if (error instanceof DeliveryError) throw error;
    invalidZip();
  }
}
