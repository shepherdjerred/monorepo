import { cp, mkdir, chmod, copyFile, readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:net";
import { z } from "zod";
import { parseForumSeed } from "#lib/forum/bootstrap.ts";
import {
  loadToolkitConfig,
  defaultToolkitConfigPath,
} from "#lib/toolkit-config.ts";

const localDir = path.resolve(import.meta.dir, "../local/forum");
const stateDir = path.join(os.homedir(), ".toolkit/forum");
const sourceDir = path.join(stateDir, "source");
const statePath = path.join(stateDir, "state.json");
const State = z.object({
  itemId: z.string().min(1),
  vaultId: z.string().min(1),
  version: z.literal("2.3.13"),
});
const Item = z
  .object({
    id: z.string(),
    vault: z.object({ id: z.string() }),
    fields: z.array(
      z
        .object({
          id: z.string(),
          label: z.string().optional(),
          type: z.string(),
          value: z.string().optional(),
        })
        .loose(),
    ),
  })
  .loose();
type Item = z.infer<typeof Item>;
const agents = ["codex", "claude", "cursor", "opencode", "antigravity", "grok"];
const secrets = new Set<string>();

async function captured(
  command: string[],
  input?: string,
  env?: Record<string, string | undefined>,
): Promise<string> {
  const child = Bun.spawn(command, {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: env ?? Bun.env,
  });
  if (input !== undefined) await child.stdin.write(input);
  await child.stdin.end();
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) {
    // Both command output and arguments may include credential material.
    let diagnostic = stderr;
    for (const value of secrets)
      diagnostic = diagnostic.replaceAll(value, "[redacted]");
    throw new Error(
      `${command.slice(0, 3).join(" ")} failed (exit ${String(code)})${diagnostic ? `: ${diagnostic.slice(-2500)}` : ""}`,
    );
  }
  return stdout;
}

async function requireLocalDocker(): Promise<void> {
  const override = Bun.env["DOCKER_HOST"];
  if (override !== undefined && !override.startsWith("unix://"))
    throw new Error("The forum trial refuses a remote DOCKER_HOST override");
  const output = await captured([
    "docker",
    "context",
    "inspect",
    "--format",
    "{{.Endpoints.docker.Host}}",
  ]);
  const endpoint = output.trim();
  if (!endpoint.startsWith("unix://"))
    throw new Error("The forum trial requires a local Docker Unix socket");
}

async function createCredentials(): Promise<Item> {
  const items = z
    .array(z.object({ id: z.string(), title: z.string() }))
    .parse(
      JSON.parse(
        await captured([
          "op",
          "item",
          "list",
          "--vault",
          "Private",
          "--format",
          "json",
        ]),
      ),
    );
  const matches = items.filter(({ title }) => title === "Agent Forum Trial");
  if (matches.length > 1)
    throw new Error("Multiple Agent Forum Trial credentials exist in Private");
  const existing = matches[0];
  if (existing !== undefined)
    return Item.parse(
      JSON.parse(
        await captured(["op", "item", "get", existing.id, "--format", "json"]),
      ),
    );
  const fields = [
    { id: "username", type: "STRING", purpose: "USERNAME", value: "Jerred" },
    ...["password", "db_password", "db_root_password"].map((id) => ({
      id,
      label: id,
      type: "CONCEALED",
      ...(id === "password" ? { purpose: "PASSWORD" } : {}),
      value: randomBytes(24).toString("hex"),
    })),
  ];
  for (const field of fields) secrets.add(field.value);
  return Item.parse(
    JSON.parse(
      await captured(
        // Bun's subprocess stdin is a socket, which op does not detect as a pipe.
        [
          "op",
          "item",
          "create",
          "--vault",
          "Private",
          "--format",
          "json",
          "--template",
          "/dev/stdin",
        ],
        JSON.stringify({
          title: "Agent Forum Trial",
          category: "LOGIN",
          urls: [{ href: "http://127.0.0.1:8765", primary: true }],
          fields,
        }),
      ),
    ),
  );
}

function secret(item: Item, id: string): string {
  const value = item.fields.find(
    (field) => field.id === id || field.label === id,
  )?.value;
  if (value === undefined || value === "")
    throw new Error(`The trial credential is missing ${id}`);
  secrets.add(value);
  return value;
}

function compose(args: string[]): string[] {
  return [
    "docker",
    "compose",
    "--project-name",
    "toolkit-forum",
    "--file",
    path.join(localDir, "compose.yaml"),
    ...args,
  ];
}
function runtimeEnv(item: Item): Record<string, string | undefined> {
  return {
    ...Bun.env,
    FORUM_SOURCE: sourceDir,
    FORUM_DB_PASSWORD: secret(item, "db_password"),
    FORUM_DB_ROOT_PASSWORD: secret(item, "db_root_password"),
  };
}

async function assertPortAvailable(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once("error", () => {
      reject(
        new Error(
          "Port 8765 is occupied; the trial will not replace its owner",
        ),
      );
    });
    server.listen(8765, "127.0.0.1", () => {
      server.close(() => {
        resolve();
      });
    });
  });
}

async function installConfig(item: Item): Promise<void> {
  const configPath = defaultToolkitConfigPath();
  const handle = Bun.file(configPath);
  const text = (await handle.exists()) ? await handle.text() : "";
  const profiles = Object.fromEntries(
    agents.map((agent) => [
      agent,
      `op://${item.vault.id}/${item.id}/${agent}_key`,
    ]),
  );
  if (/^\s*\[forum(?:\.|\])/m.test(text)) {
    const config = await loadToolkitConfig();
    const configured = await config.value("forumProfiles");
    if (
      Object.keys(configured).length !== agents.length ||
      agents.some((agent) => configured[agent] !== profiles[agent]) ||
      (await config.value("forumUrl")) !== "http://127.0.0.1:8765"
    )
      throw new Error("Existing forum configuration differs; it was preserved");
    return;
  }
  const lines = Object.entries(profiles)
    .map(([agent, reference]) => `${agent} = ${JSON.stringify(reference)}`)
    .join("\n");
  await Bun.write(
    configPath,
    `${text}\n[forum]\nurl = "http://127.0.0.1:8765"\n\n[forum.profiles]\n${lines}\n`,
  );
  await chmod(configPath, 0o600);
}

async function setup(source: string): Promise<void> {
  await assertPortAvailable();
  const versionFile = await readFile(path.join(source, "src/XF.php"), "utf8");
  if (!versionFile.includes("$version = '2.3.13'"))
    throw new Error("This trial expects the supplied XenForo 2.3.13 source");
  if (await Bun.file(statePath).exists())
    throw new Error(
      "Trial is already configured; use start to preserve its installation",
    );
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await chmod(stateDir, 0o700);
  if (await Bun.file(path.join(sourceDir, "src/XF.php")).exists()) {
    if (
      (await readFile(path.join(sourceDir, "src/config.php"), "utf8")) !==
      (await readFile(path.join(localDir, "config.php"), "utf8"))
    )
      throw new Error(
        "An unrelated source copy already exists in the trial directory",
      );
  } else {
    await cp(source, sourceDir, {
      recursive: true,
      force: false,
      errorOnExist: true,
    });
  }
  await copyFile(
    path.join(localDir, "config.php"),
    path.join(sourceDir, "src/config.php"),
  );
  const item = await createCredentials();
  await Bun.write(
    statePath,
    JSON.stringify({
      itemId: item.id,
      vaultId: item.vault.id,
      version: "2.3.13",
    }),
  );
  await chmod(statePath, 0o600);
  await start(item, true);
}

async function start(item: Item, build: boolean): Promise<void> {
  const env = runtimeEnv(item);
  const running: unknown = JSON.parse(
    await captured(compose(["ps", "--format", "json"]), undefined, env).then(
      (value) => `[${value.trim().split("\n").filter(Boolean).join(",")}]`,
    ),
  );
  if (!Array.isArray(running) || running.length === 0)
    await assertPortAvailable();
  console.log(
    "Starting local XenForo (initial PHP build can take a few minutes)…",
  );
  await captured(
    compose([
      "up",
      "-d",
      "--wait",
      "--wait-timeout",
      "180",
      ...(build ? ["--build"] : []),
    ]),
    undefined,
    env,
  );
  await captured(
    compose([
      "exec",
      "-T",
      "web",
      "sh",
      "-c",
      "chown -R www-data:www-data /var/www/html/data /var/www/html/internal_data",
    ]),
    undefined,
    env,
  );
  const installed = await captured(
    compose([
      "exec",
      "-T",
      "--user",
      "www-data",
      "web",
      "php",
      "/opt/forum/setup.php",
    ]),
    JSON.stringify({ password: secret(item, "password") }),
    env,
  );
  if (installed.trim() !== "installed")
    throw new Error(
      "XenForo installation did not complete; the database was preserved",
    );
  const seedOutput = await captured(
    compose([
      "exec",
      "-T",
      "--user",
      "www-data",
      "web",
      "php",
      "/opt/forum/setup.php",
      "--seed",
    ]),
    undefined,
    env,
  );
  const seeded = parseForumSeed(seedOutput);
  let changed = false;
  for (const [id, value] of Object.entries(seeded.keys)) {
    secrets.add(value);
    const field = item.fields.find(
      (entry) => entry.id === id || entry.label === id,
    );
    if (field === undefined) {
      item.fields.push({ id, label: id, type: "CONCEALED", value });
      changed = true;
    } else {
      if (field.value !== value) {
        field.value = value;
        changed = true;
      }
    }
  }
  const updated = changed
    ? Item.parse(
        JSON.parse(
          await captured(
            [
              "op",
              "item",
              "edit",
              item.id,
              "--format",
              "json",
              "--template",
              "/dev/stdin",
            ],
            JSON.stringify(item),
          ),
        ),
      )
    : item;
  await installConfig(updated);
  console.log(
    "Agent Workshop is ready at http://127.0.0.1:8765. Administrator: Jerred (password in 1Password → Agent Forum Trial).",
  );
}

async function main(): Promise<void> {
  const [command, source] = process.argv.slice(2);
  if (command === undefined || command === "--help") {
    console.log(
      "forum:local setup [XENFORO_UPLOAD_DIR] | start | stop | status\nsetup defaults to ~/Downloads/xenforo_2/upload. Stop preserves all volumes.",
    );
    return;
  }
  await requireLocalDocker();
  if (command === "setup") {
    await setup(
      source ?? path.join(os.homedir(), "Downloads/xenforo_2/upload"),
    );
    return;
  }
  if (source !== undefined || !["start", "stop", "status"].includes(command))
    throw new Error(
      "Use setup, start, stop, or status; only setup accepts a source path",
    );
  const state = State.parse(await Bun.file(statePath).json());
  const item = Item.parse(
    JSON.parse(
      await captured([
        "op",
        "item",
        "get",
        state.itemId,
        "--vault",
        state.vaultId,
        "--format",
        "json",
      ]),
    ),
  );
  if (command === "start") {
    await start(item, true);
    return;
  }
  if (command === "stop") {
    await captured(compose(["stop"]), undefined, runtimeEnv(item));
    console.log("Trial stopped; forum data is preserved.");
    return;
  }
  console.log(await captured(compose(["ps"]), undefined, runtimeEnv(item)));
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Local forum setup failed",
    );
    process.exitCode = 1;
  }
}
