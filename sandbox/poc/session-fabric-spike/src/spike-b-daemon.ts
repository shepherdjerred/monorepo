// Spike B: the full iMessage vertical slice, minus Temporal.
// BlueBubbles server (on this Mac) POSTs new-message webhooks here; we dedupe by
// guid, run one agent turn in a container (resuming session state from S3 via
// Spike A's machinery), and reply through the BlueBubbles REST API.
//
// Env:
//   SPIKE_BB_URL           BlueBubbles server URL (e.g. http://localhost:1234)
//   SPIKE_BB_PASSWORD      BlueBubbles server password
//   SPIKE_BB_ALLOW         comma-separated allowed sender handles (your number/email)
//   SPIKE_PROVIDER         codex | claude
//   plus the SPIKE_S3_* / AWS_* / provider-auth env that spike-a passes to containers
//
// Run: bun src/spike-b-daemon.ts   (then point BlueBubbles webhook at http://<mac>:8787/webhook)
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

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
const PROVIDER = env("SPIKE_PROVIDER");
const IMAGE = "session-fabric-spike";
const here = import.meta.dir.replace(/\/src$/, "");

// One session for the whole spike conversation; turns increment.
const sessionId = `spike-b-${PROVIDER}-${crypto.randomUUID().slice(0, 8)}`;
let turnIndex = 0;
const seenGuids = new Set<string>();
console.log(
  `[spike-b] session ${sessionId}, provider ${PROVIDER}, allow ${[...ALLOW].join(",")}`,
);

async function runTurn(text: string): Promise<string> {
  const resume = turnIndex > 0;
  const outDir = join(here, ".spike-out", `${sessionId}-t${turnIndex}`);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const forward = [
    "SPIKE_S3_ENDPOINT",
    "SPIKE_S3_BUCKET",
    "SPIKE_S3_PREFIX",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "CODEX_AUTH_JSON_B64",
    "CLAUDE_CODE_OAUTH_TOKEN",
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
  const result = JSON.parse(
    await Bun.file(join(outDir, "result.json")).text(),
  ) as { finalText: string };
  turnIndex += 1;
  return result.finalText;
}

async function sendText(chatGuid: string, text: string): Promise<void> {
  const url = `${BB_URL}/api/v1/message/text?password=${encodeURIComponent(BB_PASSWORD)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chatGuid,
      message: text,
      method: "private-api",
      tempGuid: crypto.randomUUID(),
    }),
  });
  if (!res.ok)
    console.error(
      `[spike-b] send failed: ${res.status} ${(await res.text()).slice(0, 200)}`,
    );
}

Bun.serve({
  port: 8787,
  async fetch(req) {
    if (new URL(req.url).pathname !== "/webhook") return new Response("ok");
    const body = (await req.json()) as {
      type?: string;
      data?: Record<string, unknown>;
    };
    if (body.type !== "new-message") return new Response("ignored");
    const data = body.data ?? {};
    const guid = String(data["guid"] ?? "");
    const isFromMe = data["isFromMe"] === true;
    const text = String(data["text"] ?? "");
    const handle =
      (data["handle"] as { address?: string } | undefined)?.address ?? "";
    const chatGuid =
      (data["chats"] as { guid?: string }[] | undefined)?.[0]?.guid ?? "";
    if (isFromMe || guid === "" || seenGuids.has(guid))
      return new Response("skip");
    seenGuids.add(guid);
    if (!ALLOW.has(handle)) {
      console.log(`[spike-b] drop non-allowlisted ${handle}`);
      return new Response("drop");
    }
    console.log(`[spike-b] <- ${handle}: ${text.slice(0, 80)}`);
    void (async () => {
      try {
        const reply = await runTurn(text);
        await sendText(chatGuid, reply);
        console.log(`[spike-b] -> ${reply.slice(0, 80)}`);
      } catch (err) {
        await sendText(chatGuid, `spike error: ${String(err).slice(0, 200)}`);
      }
    })();
    return new Response("accepted");
  },
});
console.log(
  "[spike-b] listening on :8787  (point BlueBubbles webhook at http://<this-mac>:8787/webhook)",
);
