import { Database } from "bun:sqlite";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const MUSE_SESSION_ID = "019a0000-0000-7000-8000-00000000b001";
export const MUSE_SUBAGENT_ID = "019a0000-0000-7000-8000-00000000b002";
export const MUSE_CREATED_US = 1_794_000_000_000_000;
export const MUSE_UPDATED_US = 1_794_000_900_000_000;

const T0 = MUSE_CREATED_US + 1_000_000;

function jsonl(records: readonly Record<string, unknown>[]): string {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

let sequence = 0;

function event(
  streamId: string,
  offsetUs: number,
  payloadType: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  sequence += 1;
  return {
    schema_version: 1,
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    stream: { kind: "session", id: streamId },
    sequence,
    recorded_at: T0 + offsetUs,
    record_type: "event",
    durability: "durable",
    causation_id: null,
    payload_type: payloadType,
    payload_schema_version: 1,
    payload,
  };
}

function run(
  streamId: string,
  offsetUs: number,
  eventValue: Record<string, unknown>,
): Record<string, unknown> {
  return event(streamId, offsetUs, "runtime.session", {
    kind: "run",
    run_id: "run-1",
    event: eventValue,
  });
}

export function museUsage(
  overrides: Record<string, number> = {},
): Record<string, number> {
  return {
    input_tokens: 10_000,
    output_tokens: 300,
    cached_tokens: 8000,
    cache_write_tokens: 0,
    cache_read_tokens: 8000,
    reasoning_tokens: 100,
    ...overrides,
  };
}

export function museRootLog(
  usage: Record<string, number> = museUsage(),
): Record<string, unknown>[] {
  const id = MUSE_SESSION_ID;
  return [
    {
      retained_frame: "session_permission_transaction",
      frame_schema_version: 1,
      outer_log_ordinal: 0,
      transaction_id: "00000000-0000-4000-8000-0000000000f0",
      children: [{ child_index: 0, record_json: "{}" }],
      content_sha256: "sha256:0",
    },
    event(id, 1, "runtime.session.metadata", {
      kind: "metadata",
      record: { workspace_root: "/Users/example/project", provider_id: "meta" },
    }),
    event(id, 2, "session.workspace_branch.observed", {
      kind: "workspace_branch",
      record: {
        workspace_root: "/Users/example/project",
        reference: { kind: "branch", name: "muse-log-branch" },
        vcs: "git",
      },
    }),
    {
      retained_marker: "omitted_by_policy",
      schema_version: 1,
      stream: { kind: "session", id },
      position: { id: "00000000-0000-4000-8000-0000000000f1", sequence: 3 },
      omitted_record: {
        record_type: "event",
        durability: "ephemeral",
        payload_type: "runtime.session",
        payload_schema_version: 1,
        payload_kind: "task",
        omission_class: "transient_progress",
      },
    },
    run(id, 4, { kind: "started", prompt: "Plan the muse-prompt-marker work" }),
    run(id, 5, {
      kind: "model_user_messages",
      messages: ["injected muse-context-marker"],
    }),
    run(id, 6, {
      kind: "reasoning_committed",
      text: "",
      encrypted_content: "opaque",
    }),
    run(id, 7, {
      kind: "model_completed",
      usage,
      duration_ms: 900,
      finish_reason: "tool_calls",
      model: "muse-wonder-1.0",
      estimated_prompt_tokens: 10_100,
    }),
    run(id, 8, {
      kind: "assistant_tool_calls_committed",
      tool_calls: [
        {
          id: "item-1",
          call_id: "call-1",
          name: "read_file",
          args: JSON.stringify({
            path: "/Users/example/project/muse-arg-marker.ts",
          }),
        },
      ],
    }),
    run(id, 9, {
      kind: "tool_result_batch_committed",
      batch_id: "batch-1",
      results: [
        {
          tool_call_index: 0,
          tool_call_id: "call-1",
          text: "muse-output-marker",
        },
      ],
    }),
    run(id, 10, {
      kind: "assistant_message_committed",
      text: "Done: muse-reply-marker",
    }),
    // The parent's view of its subagent's totals; the subagent log is the
    // source of its usage.
    event(id, 11, "subagent.control.runtime_observed", {
      kind: "subagent_control",
      record: {
        kind: "runtime_observed",
        subagent_id: MUSE_SUBAGENT_ID,
        usage: museUsage({ input_tokens: 999_999 }),
      },
    }),
  ];
}

function museSubagentLog(): Record<string, unknown>[] {
  const id = MUSE_SUBAGENT_ID;
  return [
    event(id, 20, "runtime.session.metadata", {
      kind: "metadata",
      record: { provider_id: "meta", model_id: "muse-spark-1.3" },
    }),
    run(id, 21, { kind: "started", prompt: "Recall muse-subagent-marker" }),
    run(id, 22, {
      kind: "model_completed",
      usage: museUsage({
        input_tokens: 40,
        output_tokens: 4,
        cached_tokens: 0,
        cache_read_tokens: 0,
        reasoning_tokens: 0,
      }),
      duration_ms: 50,
      model: "muse-spark-1.3",
      estimated_prompt_tokens: 41,
    }),
  ];
}

export type MuseFixture = {
  readonly museRoot: string;
  readonly sessionDir: string;
  readonly dbPath: string;
};

const SESSIONS_TABLE = `
  CREATE TABLE sessions (
    session_id TEXT UNIQUE,
    session_stream_id TEXT NOT NULL,
    session_dir TEXT NOT NULL,
    session_log_path TEXT NOT NULL,
    layout TEXT NOT NULL,
    workspace_root TEXT,
    workspace_key TEXT,
    provider_id TEXT,
    model_id TEXT,
    git_branch TEXT,
    title TEXT NOT NULL,
    first_user_prompt TEXT,
    search_text TEXT NOT NULL,
    created_at_us INTEGER,
    updated_at_us INTEGER,
    prompt_count INTEGER NOT NULL,
    status TEXT NOT NULL,
    msp_branch TEXT,
    msp_kind TEXT,
    msp_parent_session_id TEXT
  )`;

export function setMuseTitle(dbPath: string, title: string): void {
  const database = new Database(dbPath);
  database.prepare("UPDATE sessions SET title = ?").run(title);
  database.close();
}

export async function writeMuseFixture(
  museRoot: string,
  root: readonly Record<string, unknown>[] = museRootLog(),
): Promise<MuseFixture> {
  const sessionDir = path.join(
    museRoot,
    "sessions/2026/11/11",
    MUSE_SESSION_ID,
  );
  const subagentDir = path.join(sessionDir, "subagent", MUSE_SUBAGENT_ID);
  await mkdir(subagentDir, { recursive: true });
  // A subagent that has not started yet has no log and is not indexed.
  await mkdir(path.join(sessionDir, "subagent", "not-started"), {
    recursive: true,
  });
  const logPath = path.join(sessionDir, "session.jsonl");
  await writeFile(logPath, jsonl(root));
  await writeFile(
    path.join(subagentDir, "session.jsonl"),
    jsonl(museSubagentLog()),
  );
  const dbPath = path.join(museRoot, "session-index.db");
  const database = new Database(dbPath);
  database.run(SESSIONS_TABLE);
  database
    .prepare(
      `INSERT INTO sessions (session_id, session_stream_id, session_dir,
         session_log_path, layout, workspace_root, workspace_key, provider_id,
         model_id, git_branch, title, first_user_prompt, search_text,
         created_at_us, updated_at_us, prompt_count, status, msp_branch,
         msp_kind, msp_parent_session_id)
       VALUES (?, ?, ?, ?, 'session_jsonl', '/Users/example/project',
         '/Users/example/project', 'meta', '', NULL, 'Muse fixture title',
         'Plan the work', 'plan', ?, ?, 1, 'valid', 'muse-index-branch',
         'root', NULL)`,
    )
    .run(
      MUSE_SESSION_ID,
      MUSE_SESSION_ID,
      sessionDir,
      logPath,
      MUSE_CREATED_US,
      MUSE_UPDATED_US,
    );
  database.close();
  return { museRoot, sessionDir, dbPath };
}
