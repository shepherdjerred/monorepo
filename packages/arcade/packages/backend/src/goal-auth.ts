import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";

const SubscriptionAuthSchema = z.object({
  auth_mode: z.literal("chatgpt").optional(),
  tokens: z.object({
    access_token: z.string().min(1),
    account_id: z.string().min(1),
    refresh_token: z.string().min(1),
  }),
});

/** Codex SDK uses the CLI's auth cache for ChatGPT subscription credentials. */
export async function prepareGoalAuth(
  environment: Readonly<Record<string, string | undefined>>,
  databasePath: string,
): Promise<string> {
  const encoded = z.base64().safeParse(environment["CODEX_AUTH_JSON_B64"]);
  if (!encoded.success)
    throw new Error("Emerald goals require CODEX_AUTH_JSON_B64");
  const contents = Buffer.from(encoded.data, "base64").toString("utf8");
  const configured = parseAuth(contents);
  const home = path.join(
    path.dirname(path.resolve(databasePath)),
    ".codex-auth",
  );
  await mkdir(home, { recursive: true, mode: 0o700 });
  const directory = await lstat(home);
  if (!directory.isDirectory() || directory.isSymbolicLink())
    throw new Error("Emerald authentication home must be a directory");
  await chmod(home, 0o700);
  const authFile = path.join(home, "auth.json");
  const seedFile = path.join(home, "seed.sha256");
  const cached = await readPrivateFile(authFile);
  const seed = await readPrivateFile(seedFile);
  const digest = createHash("sha256").update(encoded.data).digest("hex");
  if (seed !== undefined && !/^[a-f0-9]{64}$/u.test(seed))
    throw new Error("Invalid Emerald authentication seed marker");
  if (cached !== undefined) {
    const current = parseAuth(cached);
    if (seed === digest) {
      if (current.tokens.account_id !== configured.tokens.account_id)
        throw new Error("Emerald authentication cache changed accounts");
      // The CLI may have refreshed these tokens since the vault seed was copied.
      return home;
    }
    if (seed === undefined && cached !== contents)
      throw new Error("Emerald authentication cache lacks its seed marker");
  }
  // A changed vault credential explicitly replaces the previous seed. Atomic
  // writes preserve a complete cache if the process stops during rotation.
  await writePrivateFile(authFile, contents);
  await writePrivateFile(seedFile, digest);
  return home;
}

function parseAuth(contents: string) {
  try {
    const parsed: unknown = JSON.parse(contents);
    const result = SubscriptionAuthSchema.safeParse(parsed);
    if (result.success) return result.data;
  } catch {
    /* Do not expose credential-bearing parser diagnostics. */
  }
  throw new Error("Invalid Emerald subscription authentication");
}

async function readPrivateFile(file: string): Promise<string | undefined> {
  const entry = await lstat(file).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return;
    throw error;
  });
  if (entry === undefined) return;
  if (!entry.isFile() || entry.isSymbolicLink())
    throw new Error("Emerald authentication cache must contain regular files");
  await chmod(file, 0o600);
  return readFile(file, "utf8");
}

async function writePrivateFile(file: string, contents: string): Promise<void> {
  const temporary = `${file}.${randomUUID()}`;
  try {
    await writeFile(temporary, contents, { mode: 0o600, flag: "wx" });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}
