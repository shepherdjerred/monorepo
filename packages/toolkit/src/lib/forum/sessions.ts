import { Database } from "bun:sqlite";
import { chmod } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ForumIdentity } from "./identity.ts";
import {
  EMPTY_FORUM_CONTEXT,
  ForumContextSchema,
  type ForumContext,
} from "./context.ts";

const State = z.object({
  itemId: z.string().regex(/^[a-z0-9]+$/),
  vaultId: z.string().regex(/^[a-z0-9]+$/),
  version: z.literal("2.3.13"),
});
const Account = z.object({
  username: z.string(),
  user_id: z.number().int().positive(),
  api_key: z.string().regex(/^[\w-]{32}$/),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
});
const Item = z.object({
  id: z.string(),
  vault: z.object({ id: z.string() }),
  fields: z.array(z.object({ id: z.string(), value: z.string().optional() })),
});
const Items = z.array(z.object({ id: z.string(), title: z.string() }));
const Cached = z.object({
  username: z.string(),
  user_id: z.number().int().positive(),
  reference: z.string().regex(/^op:\/\/\S+$/),
  profile: z.string().nullable(),
});

export type ForumProcess = (args: string[], input?: string) => Promise<string>;

/** Never expose child diagnostics: Docker and 1Password output may contain keys. */
export const runForumProcess: ForumProcess = async (args, input) => {
  const child = Bun.spawn(args, {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (input !== undefined) await child.stdin.write(input);
  await child.stdin.end();
  const [stdout, , code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0)
    throw new Error(`Forum ${args[0] ?? "process"} operation failed`);
  return stdout.trim();
};

function decoded<T>(
  schema: z.ZodType<T>,
  output: string,
  layer = "provisioning tool",
): T {
  try {
    return schema.parse(JSON.parse(output));
  } catch {
    throw new Error(`Invalid response from forum ${layer}`);
  }
}

async function requireTrialContainer(run: ForumProcess, source: string) {
  if (
    Bun.env["DOCKER_HOST"] !== undefined &&
    !Bun.env["DOCKER_HOST"].startsWith("unix://")
  )
    throw new Error("Session accounts require local Docker");
  const context = decoded(
    z.array(
      z.object({
        Endpoints: z.object({ docker: z.object({ Host: z.string() }) }),
      }),
    ),
    await run(["docker", "context", "inspect"]),
    "Docker context",
  );
  if (context[0]?.Endpoints.docker.Host.startsWith("unix://") !== true)
    throw new Error("Session accounts require local Docker");
  const container = decoded(
    z.object({
      project: z.literal("toolkit-forum"),
      service: z.literal("web"),
      running: z.literal(true),
      mounts: z.array(
        z.object({
          Source: z.string(),
          Destination: z.string(),
          RW: z.boolean(),
        }),
      ),
    }),
    await run([
      "docker",
      "inspect",
      "toolkit-forum-web-1",
      "--format",
      '{"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"running":{{json .State.Running}},"mounts":{{json .Mounts}}}',
    ]),
    "Docker container",
  );
  if (
    !container.mounts.some(
      (mount) =>
        mount.Source === source &&
        mount.Destination === "/var/www/html" &&
        !mount.RW,
    )
  )
    throw new Error("Unexpected local forum source mount");
}

async function lock(db: Database) {
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      db.run("BEGIN IMMEDIATE");
      return;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "SQLITE_BUSY"
      )
        throw error;
      if (Date.now() >= deadline)
        throw new Error("Another session is provisioning; try again shortly", {
          cause: error,
        });
      await Bun.sleep(100);
    }
  }
}

type SessionOptions = {
  identity: ForumIdentity;
  directory: string;
  baseUrl: string;
  profileReference: string;
  run?: ForumProcess;
  context?: ForumContext;
};

export async function sessionForumCredentials(options: SessionOptions) {
  const { identity, directory, baseUrl, profileReference } = options;
  const run = options.run ?? runForumProcess;
  if (baseUrl.replace(/\/$/, "") !== "http://127.0.0.1:8765")
    throw new Error(
      "Session provisioning is supported only for the MacBook trial URL",
    );
  const state = decoded(
    State,
    await Bun.file(path.join(directory, "state.json")).text(),
    "local trial state",
  );
  if (
    profileReference !==
    `op://${state.vaultId}/${state.itemId}/${identity.agent}_key`
  )
    throw new Error("Forum profile does not belong to the local trial");
  const filename = path.join(directory, "sessions.sqlite");
  const db = new Database(filename, { create: true, strict: true });
  await chmod(filename, 0o600);
  let transaction = false;
  try {
    db.run("PRAGMA busy_timeout = 0");
    await lock(db);
    transaction = true;
    const { existing, context, profile, synced } = await prepareProfile(
      db,
      options,
      run,
    );
    let cached: z.infer<typeof Cached>;
    let apiKey: string;
    if (existing === null) {
      if (synced === null) throw new Error("Missing provisioned forum account");
      const account = synced;
      const title = `Agent Forum Session ${identity.legacyUsername}`;
      const matches = decoded(
        Items,
        await run([
          "op",
          "item",
          "list",
          "--vault",
          state.vaultId,
          "--format",
          "json",
        ]),
        "1Password item list",
      ).filter((item) => item.title === title);
      const match = uniqueItem(matches);
      const item =
        match === undefined
          ? decoded(
              Item,
              await run(
                [
                  "op",
                  "item",
                  "create",
                  "--template",
                  "/dev/stdin",
                  "--format",
                  "json",
                ],
                JSON.stringify({
                  title,
                  category: "LOGIN",
                  vault: { id: state.vaultId },
                  fields: [
                    {
                      id: "username",
                      type: "STRING",
                      purpose: "USERNAME",
                      value: identity.legacyUsername,
                    },
                    {
                      id: "password",
                      type: "CONCEALED",
                      purpose: "PASSWORD",
                      value: account.api_key,
                    },
                  ],
                }),
              ),
              "1Password item creation",
            )
          : decoded(
              Item,
              await run([
                "op",
                "item",
                "get",
                match.id,
                "--vault",
                state.vaultId,
                "--format",
                "json",
              ]),
              "1Password session item",
            );
      if (
        item.vault.id !== state.vaultId ||
        item.fields.find((field) => field.id === "password")?.value !==
          account.api_key ||
        item.fields.find((field) => field.id === "username")?.value !==
          identity.legacyUsername
      )
        throw new Error(
          "1Password session item does not match the forum account",
        );
      apiKey = account.api_key;
      cached = {
        username: account.username,
        user_id: account.user_id,
        reference: `op://${state.vaultId}/${item.id}/password`,
        profile,
      };
      db.query(
        "INSERT INTO sessions (digest, username, user_id, reference, profile) VALUES (?, ?, ?, ?, ?)",
      ).run(
        identity.digest,
        cached.username,
        cached.user_id,
        cached.reference,
        profile,
      );
    } else {
      cached = {
        ...existing,
        username: synced?.username ?? existing.username,
        profile,
      };
      validateCached(cached, identity, state.vaultId);
      apiKey = await run(["op", "read", cached.reference]);
      if (synced !== null && synced.api_key !== apiKey)
        throw new Error("Session key changed during profile update");
      db.query(
        "UPDATE sessions SET username = ?, profile = ? WHERE digest = ?",
      ).run(cached.username, profile, identity.digest);
    }
    if (!/^[\w-]{32}$/.test(apiKey))
      throw new Error("Invalid session key from 1Password");
    db.run("COMMIT");
    transaction = false;
    return {
      apiKey,
      identity: {
        agent: identity.agent,
        sessionId: identity.sessionId,
        username: cached.username,
        userId: cached.user_id,
        context,
        url: `${baseUrl.replace(/\/$/, "")}/index.php?members/${String(cached.user_id)}/`,
      },
    };
  } finally {
    if (transaction) db.run("ROLLBACK");
    db.close();
  }
}

function uniqueItem(items: z.infer<typeof Items>) {
  if (items.length > 1) throw new Error("Duplicate session items in 1Password");
  return items[0];
}

function mergedContext(
  current: ForumContext,
  previous: string | null,
): ForumContext {
  const context = ForumContextSchema.parse(current);
  if (previous === null) return context;
  const stored = decoded(
    z.object({
      version: z.union([z.literal(1), z.literal(2)]),
      context: ForumContextSchema,
    }),
    previous,
    "cached profile",
  );
  return { ...context, model: context.model ?? stored.context.model };
}

function validAccountName(name: string, base: string): boolean {
  return (
    name === base ||
    (name.startsWith(`${base} `) &&
      /^[2-9]\d*$|^1\d+$/.test(name.slice(base.length + 1)))
  );
}

function validateCached(
  cached: z.infer<typeof Cached>,
  identity: ForumIdentity,
  vaultId: string,
) {
  if (
    !validAccountName(cached.username, identity.username) ||
    !cached.reference.startsWith(`op://${vaultId}/`)
  )
    throw new Error("Unexpected cached forum identity");
}

async function provisionProfile(
  run: ForumProcess,
  directory: string,
  identity: ForumIdentity,
  details: { context: ForumContext; userId: number | undefined },
) {
  const { context, userId } = details;
  await requireTrialContainer(run, path.join(directory, "source"));
  const account = decoded(
    Account,
    await run(
      [
        "docker",
        "exec",
        "--user",
        "www-data",
        "-i",
        "toolkit-forum-web-1",
        "php",
        "/opt/forum/session.php",
      ],
      JSON.stringify({
        agent: identity.agent,
        sessionId: identity.sessionId,
        context,
      }),
    ),
    "XenForo session provisioner",
  );
  if (
    account.digest !== identity.digest ||
    !validAccountName(account.username, identity.username) ||
    (userId !== undefined && account.user_id !== userId)
  )
    throw new Error("Unexpected session account identity");
  return account;
}

async function prepareProfile(
  db: Database,
  options: SessionOptions,
  run: ForumProcess,
) {
  db.run(
    "CREATE TABLE IF NOT EXISTS sessions (digest TEXT PRIMARY KEY, username TEXT NOT NULL, user_id INTEGER NOT NULL, reference TEXT NOT NULL)",
  );
  const columns = z
    .array(z.object({ name: z.string() }))
    .parse(db.query("PRAGMA table_info(sessions)").all());
  if (!columns.some((column) => column.name === "profile"))
    db.run("ALTER TABLE sessions ADD COLUMN profile TEXT");
  const row = db
    .query(
      "SELECT username, user_id, reference, profile FROM sessions WHERE digest = ?",
    )
    .get(options.identity.digest);
  const existing = row === null ? null : Cached.parse(row);
  const context = mergedContext(
    options.context ?? EMPTY_FORUM_CONTEXT,
    existing?.profile ?? null,
  );
  const profile = JSON.stringify({ version: 2, context });
  const synced =
    existing?.profile === profile
      ? null
      : await provisionProfile(run, options.directory, options.identity, {
          context,
          userId: existing?.user_id,
        });
  return { existing, context, profile, synced };
}
