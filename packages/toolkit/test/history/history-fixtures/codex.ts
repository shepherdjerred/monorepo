import path from "node:path";
import { writeDatabase } from "./database.ts";

export type CodexFixture = {
  readonly codexThread: string;
  readonly codexHistory: string;
  readonly codexCatalog: string;
};

export async function writeCodexFixture(
  codexDir: string,
): Promise<CodexFixture> {
  const codexThread = path.join(codexDir, "thread_history_1.sqlite");
  writeDatabase(
    codexThread,
    "CREATE TABLE thread_items (thread_id TEXT, turn_id TEXT, item_id TEXT, rollout_ordinal INTEGER, created_at_ms INTEGER, item_json TEXT, item_type TEXT, updated_at_ordinal INTEGER, PRIMARY KEY (thread_id, turn_id, item_id));",
    (database) => {
      database.run(
        "INSERT INTO thread_items VALUES ('t1', 'turn', 'item', 1, 1786406400000, '{\"type\":\"userMessage\",\"text\":\"Repair Buildkite pipeline\"}', 'userMessage', 0)",
      );
      database.run(
        "INSERT INTO thread_items VALUES ('t1', 'turn', 'reasoning', 2, 1786406401000, '{\"text\":\"omit-codex-reasoning\"}', 'reasoning', 0)",
      );
      database.run(
        "INSERT INTO thread_items VALUES ('t1', 'turn', 'tool', 3, 1786406402000, '{\"command\":\"bk build view\"}', 'commandExecution', 0)",
      );
    },
  );
  const codexHistory = path.join(codexDir, "history.jsonl");
  await Bun.write(
    codexHistory,
    `${JSON.stringify({ session_id: "history-session", timestamp: "2026-08-13T00:00:00Z", prompt: "Review deployment status" })}\nnot-json\n"scalar prompt"\n${JSON.stringify({ session_id: "metadata-only" })}\n${JSON.stringify(
      {
        session_id: "t-multi-prompt",
        timestamp: "2026-08-13T00:01:00Z",
        prompt: "First prompt in a multi-prompt session",
      },
    )}\n${JSON.stringify(
      // Same session as above (multi-prompt session, no thread-history row
      // or catalog entry) — its usage must be attached to only one of these
      // two prompt documents, not both.
      {
        session_id: "t-multi-prompt",
        timestamp: "2026-08-13T00:02:00Z",
        prompt: "Second prompt in the same session",
      },
    )}\n`,
  );
  const codexCatalog = path.join(codexDir, "codex-dev.db");
  writeDatabase(
    codexCatalog,
    "CREATE TABLE local_thread_catalog (host_id TEXT, thread_id TEXT, display_title TEXT, source_created_at REAL, source_updated_at REAL, cwd TEXT, model_provider TEXT, git_branch TEXT, missing_candidate INTEGER);",
    (database) => {
      database.run(
        "INSERT INTO local_thread_catalog VALUES ('host', 't1', 'Cataloged work', 1786406400, 1786406400, '/workspace', 'openai', 'main', 0)",
      );
      database.run(
        "INSERT INTO local_thread_catalog VALUES ('host', 't2', 'Catalog only', 1786406400, 1786406400, '/catalog', 'openai', 'feature', 0)",
      );
    },
  );
  return { codexThread, codexHistory, codexCatalog };
}

export async function writeCodexSessionUsageFixture(
  sessionsDir: string,
): Promise<void> {
  const lines = [
    {
      timestamp: "2026-08-08T00:00:00.000Z",
      ordinal: 0,
      type: "session_meta",
      payload: { session_id: "t1", id: "t1" },
    },
    {
      timestamp: "2026-08-08T00:00:01.000Z",
      ordinal: 1,
      type: "event_msg",
      payload: {
        type: "thread_settings_applied",
        thread_settings: { model: "gpt-5.6-sol" },
      },
    },
    {
      timestamp: "2026-08-08T00:00:02.000Z",
      ordinal: 2,
      type: "token_usage_record",
      payload: {
        turn_token_usage: {
          input_tokens: 1000,
          cached_input_tokens: 400,
          cache_write_input_tokens: 0,
          output_tokens: 100,
          reasoning_output_tokens: 20,
          total_tokens: 1100,
        },
      },
    },
    {
      // Deliberately outside a `--since 7d`-from-now window: proves usage
      // aggregation reads this event's own timestamp, not the document's.
      timestamp: "2026-08-14T00:00:00.000Z",
      ordinal: 3,
      type: "token_usage_record",
      payload: {
        turn_token_usage: {
          input_tokens: 50,
          cached_input_tokens: 0,
          cache_write_input_tokens: 0,
          output_tokens: 10,
          reasoning_output_tokens: 0,
          total_tokens: 60,
        },
      },
    },
  ];
  await Bun.write(
    path.join(sessionsDir, "rollout-t1.jsonl"),
    `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
  );

  // t-truly-orphan has no thread_history row, no catalog entry, and no
  // history.jsonl prompt — proves usage isn't silently dropped for a
  // rollout the other Codex trees don't represent at all (e.g. a CLI-only
  // install with no local history db).
  const orphanLines = [
    {
      timestamp: "2026-08-09T00:00:00.000Z",
      ordinal: 0,
      type: "session_meta",
      payload: { session_id: "t-truly-orphan", id: "t-truly-orphan" },
    },
    {
      timestamp: "2026-08-09T00:00:01.000Z",
      ordinal: 1,
      type: "event_msg",
      payload: {
        type: "thread_settings_applied",
        thread_settings: { model: "gpt-5.6-sol" },
      },
    },
    {
      timestamp: "2026-08-09T00:00:02.000Z",
      ordinal: 2,
      type: "token_usage_record",
      payload: {
        turn_token_usage: {
          input_tokens: 300,
          cached_input_tokens: 0,
          cache_write_input_tokens: 0,
          output_tokens: 40,
          reasoning_output_tokens: 0,
          total_tokens: 340,
        },
      },
    },
  ];
  await Bun.write(
    path.join(sessionsDir, "rollout-orphan.jsonl"),
    `${orphanLines.map((line) => JSON.stringify(line)).join("\n")}\n`,
  );

  // t-multi-prompt has two history.jsonl prompts (no thread-history row or
  // catalog entry) — proves its usage is attached to exactly one of those
  // documents, not summed once per prompt.
  const multiPromptLines = [
    {
      timestamp: "2026-08-10T00:00:00.000Z",
      ordinal: 0,
      type: "session_meta",
      payload: { session_id: "t-multi-prompt", id: "t-multi-prompt" },
    },
    {
      timestamp: "2026-08-10T00:00:01.000Z",
      ordinal: 1,
      type: "event_msg",
      payload: {
        type: "thread_settings_applied",
        thread_settings: { model: "gpt-5.6-sol" },
      },
    },
    {
      timestamp: "2026-08-10T00:00:02.000Z",
      ordinal: 2,
      type: "token_usage_record",
      payload: {
        turn_token_usage: {
          input_tokens: 500,
          cached_input_tokens: 0,
          cache_write_input_tokens: 0,
          output_tokens: 60,
          reasoning_output_tokens: 0,
          total_tokens: 560,
        },
      },
    },
  ];
  await Bun.write(
    path.join(sessionsDir, "rollout-multi-prompt.jsonl"),
    `${multiPromptLines.map((line) => JSON.stringify(line)).join("\n")}\n`,
  );
}

export async function writeCodexRolloutFormatFixtures(
  sessionsDir: string,
): Promise<void> {
  // t-current-format uses only the current rollout event shapes
  // (turn_context for the model, event_msg/token_count for per-turn usage)
  // with no token_usage_record/thread_settings_applied at all — proves usage
  // is still captured for Codex versions that only emit the newer format.
  const currentFormatLines = [
    {
      timestamp: "2026-08-11T00:00:00.000Z",
      ordinal: 0,
      type: "session_meta",
      payload: { session_id: "t-current-format", id: "t-current-format" },
    },
    {
      timestamp: "2026-08-11T00:00:01.000Z",
      ordinal: 1,
      type: "turn_context",
      payload: { turn_id: "turn-1", model: "gpt-5.6-terra" },
    },
    {
      timestamp: "2026-08-11T00:00:02.000Z",
      ordinal: 2,
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: {
            input_tokens: 700,
            cached_input_tokens: 100,
            cache_write_input_tokens: 0,
            output_tokens: 90,
            reasoning_output_tokens: 15,
            total_tokens: 790,
          },
          total_token_usage: {
            input_tokens: 700,
            cached_input_tokens: 100,
            cache_write_input_tokens: 0,
            output_tokens: 90,
            reasoning_output_tokens: 15,
            total_tokens: 790,
          },
        },
      },
    },
  ];
  await Bun.write(
    path.join(sessionsDir, "rollout-current-format.jsonl"),
    `${currentFormatLines.map((line) => JSON.stringify(line)).join("\n")}\n`,
  );

  // t-both-formats-present has an old-format turn (input_tokens: 111) and an
  // unrelated new-format turn (input_tokens: 999) in the same file — a
  // combination real rollouts never actually produce (a single Codex process
  // invocation writes one format for its whole lifetime; see the comment on
  // `CodexRolloutAccumulator`), but proves the defensive fallback picks the
  // current format wholesale rather than attempting a per-turn merge that a
  // count-based join can never safely resolve.
  const bothFormatsPresentLines = [
    {
      timestamp: "2026-08-12T00:00:00.000Z",
      ordinal: 0,
      type: "session_meta",
      payload: {
        session_id: "t-both-formats-present",
        id: "t-both-formats-present",
      },
    },
    {
      timestamp: "2026-08-12T00:00:01.000Z",
      ordinal: 1,
      type: "event_msg",
      payload: {
        type: "thread_settings_applied",
        thread_settings: { model: "gpt-5.6-sol" },
      },
    },
    {
      timestamp: "2026-08-12T00:00:02.000Z",
      ordinal: 2,
      type: "token_usage_record",
      payload: {
        turn_token_usage: {
          input_tokens: 111,
          cached_input_tokens: 0,
          cache_write_input_tokens: 0,
          output_tokens: 11,
          reasoning_output_tokens: 0,
          total_tokens: 122,
        },
      },
    },
    {
      timestamp: "2026-08-12T00:00:03.000Z",
      ordinal: 3,
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: {
            input_tokens: 999,
            cached_input_tokens: 0,
            cache_write_input_tokens: 0,
            output_tokens: 99,
            reasoning_output_tokens: 0,
            total_tokens: 1098,
          },
        },
      },
    },
  ];
  await Bun.write(
    path.join(sessionsDir, "rollout-both-formats-present.jsonl"),
    `${bothFormatsPresentLines.map((line) => JSON.stringify(line)).join("\n")}\n`,
  );

  // t-repeated-format has two distinct current-format turns that happen to
  // report identical token counts, with no token_usage_record at all —
  // proves a coincidental signature collision between two legitimate turns
  // never causes one to be dropped as a false cross-format duplicate.
  const repeatedFormatLines = [
    {
      timestamp: "2026-08-13T00:00:00.000Z",
      ordinal: 0,
      type: "session_meta",
      payload: { session_id: "t-repeated-format", id: "t-repeated-format" },
    },
    {
      timestamp: "2026-08-13T00:00:01.000Z",
      ordinal: 1,
      type: "turn_context",
      payload: { turn_id: "turn-1", model: "gpt-5.6-terra" },
    },
    {
      timestamp: "2026-08-13T00:00:02.000Z",
      ordinal: 2,
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: {
            input_tokens: 333,
            cached_input_tokens: 0,
            cache_write_input_tokens: 0,
            output_tokens: 33,
            reasoning_output_tokens: 0,
            total_tokens: 366,
          },
        },
      },
    },
    {
      timestamp: "2026-08-13T00:00:03.000Z",
      ordinal: 3,
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: {
            input_tokens: 333,
            cached_input_tokens: 0,
            cache_write_input_tokens: 0,
            output_tokens: 33,
            reasoning_output_tokens: 0,
            total_tokens: 366,
          },
        },
      },
    },
  ];
  await Bun.write(
    path.join(sessionsDir, "rollout-repeated-format.jsonl"),
    `${repeatedFormatLines.map((line) => JSON.stringify(line)).join("\n")}\n`,
  );
}
