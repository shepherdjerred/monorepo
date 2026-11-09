import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { codexLauncherPath } from "#lib/agent-runner/codex-launcher.ts";
import { codexScopedPermissions } from "#lib/agent-runner/codex-permissions/policy.ts";
import { z } from "zod/v4";

if (process.platform !== "darwin")
  throw new Error("This native acceptance probe requires macOS");
const root = await mkdtemp(path.join(tmpdir(), "promotion-code-gate-"));
const mailbox = path.join(root, "mailbox"),
  work = path.join(root, "work"),
  home = path.join(root, "provider-home");
await Promise.all([mkdir(mailbox), mkdir(work), mkdir(home)]);
await mkdir(path.join(home, ".codex"));
const message = path.join(mailbox, "fixture.eml"),
  link = path.join(work, "linked.eml"),
  socket = path.join(root, "tool.sock");
await Bun.write(
  message,
  "Synthetic mailbox fixture; contains no real mail or credentials.\n",
);
await symlink(message, link);
const server = Bun.serve({
  unix: socket,
  fetch: () => Response.json({ scopedTool: true }),
});
try {
  const config = codexScopedPermissions({
    auth: { kind: "openai-api-key", apiKey: "fixture-only" },
    sandboxPolicy: {
      sandboxMode: "workspace-write",
      networkAccessEnabled: true,
      webSearchMode: "disabled",
    },
    scopedPermissions: { denyReadPaths: [mailbox], unixSockets: [socket] },
  });
  if (config === undefined)
    throw new Error("Native permission configuration missing");
  const program = `const denied=async p=>{try{await Bun.file(p).text();return false}catch(e){return e.code==='EPERM'||e.code==='EACCES'}}; const tool=await fetch('http://task/tool',{unix:${JSON.stringify(socket)}});console.log(JSON.stringify({directDenied:await denied(${JSON.stringify(message)}),symlinkDenied:await denied(${JSON.stringify(link)}),toolReachable:(await tool.json()).scopedTool===true}));`;
  const overrides = [
    `default_permissions=${JSON.stringify(config.config.default_permissions)}`,
    ...config.configOverrides,
  ].flatMap((value) => ["--config", value]);
  const child = Bun.spawn(
    [
      process.execPath,
      codexLauncherPath(),
      "sandbox",
      ...overrides,
      "--permission-profile",
      "agent-task",
      "--cd",
      work,
      "--",
      process.execPath,
      "-e",
      program,
    ],
    {
      env: {
        PATH: Bun.env["PATH"],
        HOME: home,
        CODEX_HOME: path.join(home, ".codex"),
      },
      stdout: "pipe",
      stderr: "pipe",
      signal: AbortSignal.timeout(30_000),
    },
  );
  const [output, error, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0)
    throw new Error(`Native code-gate probe failed: ${error.slice(-3000)}`);
  const proof = z
    .object({
      directDenied: z.literal(true),
      symlinkDenied: z.literal(true),
      toolReachable: z.literal(true),
    })
    .parse(JSON.parse(output));
  process.stdout.write(`${JSON.stringify(proof)}\n`);
} finally {
  await server.stop(true);
  await rm(root, { recursive: true, force: true });
}
