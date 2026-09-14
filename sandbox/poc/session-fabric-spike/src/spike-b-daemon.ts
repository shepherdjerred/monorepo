// Spike B: the full iMessage vertical slice, minus Temporal.
// BlueBubbles server (on this Mac) POSTs new-message webhooks here; we dedupe by
// guid, run one agent turn in a container (resuming session state from S3 via
// Spike A's machinery), and reply through the BlueBubbles REST API.
//
// Env:
//   SPIKE_BB_URL           BlueBubbles server URL (e.g. http://localhost:1234)
//   SPIKE_BB_PASSWORD      BlueBubbles server password
//   SPIKE_BB_ALLOW         comma-separated allowed sender handles (your number/email)
//   SPIKE_WEBHOOK_SECRET   shared secret required on the webhook path (?secret=)
//   SPIKE_PROVIDER         codex | claude
//   plus the SPIKE_S3_* / AWS_* / provider-auth env that spike-a passes to containers
//
// Run: bun src/spike-b-daemon.ts
// Then point the BlueBubbles webhook at http://127.0.0.1:8787/webhook?secret=<SPIKE_WEBHOOK_SECRET>
// (loopback only; if BlueBubbles runs elsewhere, front this with an authenticated tunnel).
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod/v4";

function env(name: string): string {
  const v = Bun.env[name];
  if (v === undefined || v === "") throw new Error(`missing env: ${name}`);
  return v;
}

const BB_URL = env("SPIKE_BB_URL");
const BB_PASSWORD = env("SPIKE_BB_PASSWORD");
const ALLOW = new Set(
  env("SPIKE_BB_ALLOW")
    .split(",")
    .map((s) => s.trim()),
);
const WEBHOOK_SECRET = env("SPIKE_WEBHOOK_SECRET");
const ProviderSchema = z.enum(["codex", "claude"]);
const PROVIDER = ProviderSchema.parse(env("SPIKE_PROVIDER"));
const TurnResultSchema = z.strictObject({ finalText: z.string() });
const IMAGE = "session-fabric-spike";
const here = import.meta.dir.replace(/\/src$/, "");

// BlueBubbles new-message webhook shape (only the fields we use); unknown fields ignored.
const WebhookSchema = z.object({
  type: z.string(),
  data: z
    .object({
      guid: z.string().optional(),
      isFromMe: z.boolean().optional(),
      text: z.string().optional(),
      handle: z.object({ address: z.string().optional() }).nullish(),
      chats: z.array(z.object({ guid: z.string().optional() })).optional(),
    })
    .optional(),
});

// One session for the whole spike conversation; turns increment.
const sessionId = `spike-b-${PROVIDER}-${crypto.randomUUID().slice(0, 8)}`;
let turnIndex = 0;
const seenGuids = new Set<string>();
// Serialize turns per session: webhooks that arrive mid-turn chain onto the
// prior one so turnIndex/resume/output keys never race.
let turnChain: Promise<unknown> = Promise.resolve();
console.log(
  `[spike-b] session ${sessionId}, provider ${PROVIDER}, allow ${[...ALLOW].join(",")}`,
);

async function runTurn(text: string): Promise<string> {
  const resume = turnIndex > 0;
  const outDir = join(here, ".spike-out", `${sessionId}-t${turnIndex}`);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const providerCredential =
    PROVIDER === "codex" ? "CODEX_AUTH_JSON_B64" : "CLAUDE_CODE_OAUTH_TOKEN";
  const forward = [
    "SPIKE_S3_ENDPOINT",
    "SPIKE_S3_BUCKET",
    "SPIKE_S3_PREFIX",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    providerCredential,
  ].filter((k) => Bun.env[k] !== undefined);
  const perTurn: Record<string, string> = {
    SPIKE_PROVIDER: PROVIDER,
    SPIKE_SESSION_ID: sessionId,
    SPIKE_TURN: String(turnIndex),
    SPIKE_RESUME: resume ? "1" : "0",
    SPIKE_PROMPT: text,
  };
  const args = ["docker", "run", "--rm", "-v", `${outDir}:/out`];
  for (const k of forward) args.push("-e", k);
  for (const k of Object.keys(perTurn)) args.push("-e", k);
  args.push(IMAGE);
  const proc = Bun.spawn(args, {
    env: { ...process.env, ...perTurn },
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await proc.exited) !== 0) throw new Error("turn container failed");
  const result = TurnResultSchema.parse(
    JSON.parse(await Bun.file(join(outDir, "result.json")).text()),
  );
  turnIndex += 1;
  return result.finalText;
}

async function sendText(chatGuid: string, text: string): Promise<void> {
  const url = `${BB_URL}/api/v1/message/text?password=${encodeURIComponent(BB_PASSWORD)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // Default (AppleScript) backend so the round trip works without the
    // BlueBubbles Private API helper, which the README setup skips.
    body: JSON.stringify({
      chatGuid,
      message: text,
      tempGuid: crypto.randomUUID(),
    }),
  });
  if (!res.ok)
    console.error(
      `[spike-b] send failed: ${res.status} ${(await res.text()).slice(0, 200)}`,
    );
}

async function run(cmd: string[]): Promise<void> {
  const proc = Bun.spawn(cmd, { stdout: "inherit", stderr: "inherit" });
  if ((await proc.exited) !== 0)
    throw new Error(`${cmd.join(" ").slice(0, 120)} failed`);
}

console.log(`[spike-b] building image...`);
await run(["docker", "build", "-q", "-t", IMAGE, here]);

Bun.serve({
  // Loopback only: the webhook invokes a bypass-permission agent holding live
  // provider + S3 credentials, so it must not be reachable off-host. A shared
  // secret gates it even against local processes.
  hostname: "127.0.0.1",
  port: 8787,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname !== "/webhook") return new Response("ok");
    if (url.searchParams.get("secret") !== WEBHOOK_SECRET) {
      return new Response("unauthorized", { status: 401 });
    }
    const parsed = WebhookSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return new Response("bad request", { status: 400 });
    const body = parsed.data;
    if (body.type !== "new-message") return new Response("ignored");
    const data = body.data ?? {};
    const guid = data.guid ?? "";
    const text = data.text ?? "";
    const handle = data.handle?.address ?? "";
    const chatGuid = data.chats?.[0]?.guid ?? "";
    if (data.isFromMe === true || guid === "" || seenGuids.has(guid))
      return new Response("skip");
    seenGuids.add(guid);
    if (!ALLOW.has(handle)) {
      console.log(`[spike-b] drop non-allowlisted ${handle}`);
      return new Response("drop");
    }
    console.log(`[spike-b] <- ${handle}: ${text.slice(0, 80)}`);
    const processTurn = async (): Promise<void> => {
      try {
        const reply = await runTurn(text);
        await sendText(chatGuid, reply);
        console.log(`[spike-b] -> ${reply.slice(0, 80)}`);
      } catch (err) {
        try {
          await sendText(chatGuid, `spike error: ${String(err).slice(0, 200)}`);
        } catch (sendError) {
          console.error(`[spike-b] error reply failed: ${String(sendError)}`);
        }
      }
    };
    turnChain = turnChain.then(processTurn, processTurn);
    return new Response("accepted");
  },
});
console.log(
  "[spike-b] listening on 127.0.0.1:8787  (BlueBubbles webhook: http://127.0.0.1:8787/webhook?secret=…)",
);
