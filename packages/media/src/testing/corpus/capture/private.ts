import path from "node:path";
import { constants, lstat, mkdir, open, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PrivateCaptureContentError } from "./diagnostics.ts";

/** Refuse credential-bearing allowlisted strings too; stripping unknown keys alone is insufficient. */
export function assertPrivateCaptureContent(
  value: unknown,
  credentials: readonly string[],
) {
  inspectPrivateCaptureContent(value, credentials, []);
}
function inspectPrivateCaptureContent(
  value: unknown,
  credentials: readonly string[],
  location: readonly PropertyKey[],
) {
  if (typeof value === "string") {
    assertPrivateString(value, credentials, location);
  } else if (Array.isArray(value)) {
    for (const [index, item] of value.entries())
      inspectPrivateCaptureContent(item, credentials, [...location, index]);
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (
        /^(?:api[_-]?key|passkey|password|authorization|cookie|token|url|base[_-]?url|download[_-]?url|details[_-]?url)$/iu.test(
          key,
        )
      )
        throw new PrivateCaptureContentError(
          [...location, key],
          "forbidden_key",
        );
      inspectPrivateCaptureContent(item, credentials, [...location, key]);
    }
  }
}
function assertPrivateString(
  value: string,
  credentials: readonly string[],
  location: readonly PropertyKey[],
) {
  if (credentials.some((secret) => secret.length > 0 && value.includes(secret)))
    throw new PrivateCaptureContentError(location, "credential_literal");
  if (/\b[a-z][a-z0-9+.-]*:\/\/|magnet:\?/iu.test(value))
    throw new PrivateCaptureContentError(location, "url_value");
  if (
    /(?:api[_-]?key|passkey|password|(?:access[_-]?)?token|authorization|cookie)\s*[=:]/iu.test(
      value,
    )
  )
    throw new PrivateCaptureContentError(location, "credential_pattern");
}
function within(root: string, target: string) {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}
async function noSymlinks(directory: string) {
  let current = path.parse(directory).root;
  for (const component of directory
    .slice(current.length)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, component);
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("Private capture parent must be a real directory");
  }
}
export async function validatePrivateCaptureDestination(
  directory: string,
  worktree: string,
) {
  if (!path.isAbsolute(directory) || path.resolve(directory) !== directory)
    throw new Error("Explicit normalized absolute private directory required");
  await noSymlinks(path.dirname(directory));
  const root = await realpath(worktree);
  if (within(root, directory))
    throw new Error("Private captures must remain outside the worktree");
  try {
    await lstat(directory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return;
    throw error;
  }
  throw new Error("Private capture destination already exists");
}
export async function createPrivateCaptureDirectory(
  directory: string,
  worktree: string,
) {
  await validatePrivateCaptureDestination(directory, worktree);
  await mkdir(directory, { mode: 0o700 });
  const original = await lstat(directory);
  if ((original.mode & 0o777) !== 0o700)
    throw new Error("Private capture directory mode changed");
  async function assertDirectory() {
    await noSymlinks(directory);
    const current = await lstat(directory);
    if (
      current.dev !== original.dev ||
      current.ino !== original.ino ||
      (current.mode & 0o777) !== 0o700
    )
      throw new Error("Private capture directory changed");
  }
  return {
    async write(name: string, value: unknown, credentials: readonly string[]) {
      if (!/^[a-z-]+\.json$/u.test(name))
        throw new Error("Invalid private artifact name");
      assertPrivateCaptureContent(value, credentials);
      await assertDirectory();
      const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
      if (bytes.length > 64 * 1024 * 1024)
        throw new Error("Private artifact byte limit exceeded");
      const file = await open(
        path.join(directory, name),
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await assertDirectory();
        await file.writeFile(bytes);
        await file.sync();
        const stat = await file.stat();
        if ((stat.mode & 0o777) !== 0o600 || !stat.isFile())
          throw new Error("Private artifact identity changed");
      } finally {
        await file.close();
      }
      return {
        path: name,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    },
  };
}
