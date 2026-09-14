// Host orchestrator for Spike A: cross-host session resume.
// Turn 1 runs in container A (fresh state), pushes the session slice to
// SeaweedFS. Turn 2 runs in container B (fresh state), hydrates from S3 only,
// resumes, and must recall a codeword from turn 1.
//
// Usage: bun src/spike-a.ts <codex|claude>
// Credentials are read locally (Keychain / ~/.codex/auth.json / aws profile)
// and passed into containers via env — never printed.
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { deleteSession } from "./bundle.ts";

const provider = Bun.argv[2];
if (provider !== "codex" && provider !== "claude")
  throw new Error("usage: bun src/spike-a.ts <codex|claude>");

const CODEWORD = "PLUM-OCELOT-47";
const IMAGE = "session-fabric-spike";
const here = import.meta.dir.replace(/\/src$/, "");

async function capture(cmd: string[], stdin?: string): Promise<string> {
  const proc = Bun.spawn(cmd, {
    stdin: stdin === undefined ? undefined : new TextEncoder().encode(stdin),
    stderr: "pipe",
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0)
    throw new Error(`${cmd[0]} failed (${code}): ${err.slice(-500)}`);
  return out.trim();
}

async function run(cmd: string[]): Promise<void> {
  const proc = Bun.spawn(cmd, { stdout: "inherit", stderr: "inherit" });
  if ((await proc.exited) !== 0)
    throw new Error(`${cmd.join(" ").slice(0, 120)} failed`);
}

// --- credentials (values never printed) ---
async function awsCred(key: string): Promise<string> {
  return capture(["aws", "configure", "get", key, "--profile", "seaweedfs"]);
}

async function codexEnv(): Promise<Record<string, string>> {
  const authPath = `${Bun.env["HOME"]}/.codex/auth.json`;
  const raw = await Bun.file(authPath).text();
  const parsed: unknown = JSON.parse(raw);
  const access = (parsed as { tokens?: { access_token?: string } }).tokens
    ?.access_token;
  if (typeof access !== "string" || access === "")
    throw new Error("no codex access token; run `codex login`");
  // ChatGPT-subscription auth: the SDK reads auth.json from CODEX_HOME. Passing
  // CODEX_ACCESS_TOKEN as env flips it into API-key mode → 401. auth.json only.
  return { CODEX_AUTH_JSON_B64: Buffer.from(raw).toString("base64") };
}

async function claudeEnv(): Promise<Record<string, string>> {
  const blob = await capture([
    "security",
    "find-generic-password",
    "-s",
    "Claude Code-credentials",
    "-w",
  ]);
  const parsed: unknown = JSON.parse(blob);
  const token = (parsed as { claudeAiOauth?: { accessToken?: string } })
    .claudeAiOauth?.accessToken;
  if (typeof token !== "string" || token === "") {
    throw new Error(
      "no claude oauth token in Keychain; run `claude setup-token` and export CLAUDE_CODE_OAUTH_TOKEN",
    );
  }
  return { CLAUDE_CODE_OAUTH_TOKEN: token };
}

const providerEnv = provider === "codex" ? await codexEnv() : await claudeEnv();
const shared: Record<string, string> = {
  ...providerEnv,
  AWS_ACCESS_KEY_ID: await awsCred("aws_access_key_id"),
  AWS_SECRET_ACCESS_KEY: await awsCred("aws_secret_access_key"),
  SPIKE_S3_ENDPOINT: "https://seaweedfs-s3.tailnet-1a49.ts.net",
  SPIKE_S3_BUCKET: "llm-archive",
  SPIKE_S3_PREFIX: "sandbox-spikes/session-fabric",
  SPIKE_PROVIDER: provider,
};

console.log(`[spike-a] building image...`);
await run(["docker", "build", "-q", "-t", IMAGE, here]);

const sessionId = `spike-${provider}-${crypto.randomUUID().slice(0, 8)}`;
console.log(`[spike-a] session: ${sessionId}`);

async function turn(
  turnIndex: number,
  resume: boolean,
  prompt: string,
): Promise<{ providerSessionId: string; finalText: string }> {
  const outDir = join(here, ".spike-out", `${sessionId}-t${turnIndex}`);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const env = {
    ...shared,
    SPIKE_SESSION_ID: sessionId,
    SPIKE_TURN: String(turnIndex),
    SPIKE_RESUME: resume ? "1" : "0",
    SPIKE_PROMPT: prompt,
  };
  const args = ["docker", "run", "--rm", "-v", `${outDir}:/out`];
  for (const key of Object.keys(env)) args.push("-e", key);
  args.push(IMAGE);
  const proc = Bun.spawn(args, {
    env: { ...process.env, ...env },
    stdout: "inherit",
    stderr: "inherit",
  });
  if ((await proc.exited) !== 0)
    throw new Error(`turn ${turnIndex} container failed`);
  const result: unknown = JSON.parse(
    await Bun.file(join(outDir, "result.json")).text(),
  );
  return result as { providerSessionId: string; finalText: string };
}

// deleteSession() reads S3 config from the host env; mirror what the containers get.
for (const key of [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "SPIKE_S3_ENDPOINT",
  "SPIKE_S3_BUCKET",
  "SPIKE_S3_PREFIX",
]) {
  process.env[key] = shared[key];
}

let passed = false;
try {
  console.log(`[spike-a] turn 1 (container A, fresh)...`);
  const t1 = await turn(
    0,
    false,
    `Remember this codeword: ${CODEWORD}. Reply with exactly: OK`,
  );
  console.log(
    `[spike-a] turn 1 done. providerSessionId=${t1.providerSessionId} reply=${JSON.stringify(t1.finalText.slice(0, 80))}`,
  );

  console.log(
    `[spike-a] turn 2 (container B, fresh fs, hydrated from S3 only)...`,
  );
  const t2 = await turn(
    1,
    true,
    "What is the codeword I told you earlier? Reply with just the codeword.",
  );
  console.log(
    `[spike-a] turn 2 reply=${JSON.stringify(t2.finalText.slice(0, 120))}`,
  );
  passed = t2.finalText.includes(CODEWORD);
} finally {
  await deleteSession(sessionId).catch((err) =>
    console.error(`[spike-a] cleanup failed: ${String(err).slice(0, 200)}`),
  );
}

if (passed) {
  console.log(
    `[spike-a] ✅ PASS: ${provider} resumed across containers via S3 bundle`,
  );
} else {
  console.log(`[spike-a] ❌ FAIL: reply did not contain the codeword`);
  process.exit(1);
}
