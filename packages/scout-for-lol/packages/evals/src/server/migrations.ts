import type { Database } from "bun:sqlite";
import { z } from "zod";

const MigrationLedgerRowSchema = z.strictObject({
  version: z.number().int().positive(),
  name: z.string().min(1),
});

const GenerationCountRowSchema = z.strictObject({
  count: z.number().int().nonnegative(),
});

type Migration = Readonly<{
  version: number;
  name: string;
  sql: string;
  beforeApply?: (database: Database) => void;
}>;

const MIGRATION_LEDGER_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
    applied_at TEXT NOT NULL CHECK (applied_at GLOB '????-??-??T??:??:??.???Z')
  ) STRICT;
`;

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "initial_eval_store",
    sql: `
      CREATE TABLE datasets (
        id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
        dataset_key TEXT NOT NULL CHECK (length(trim(dataset_key)) > 0),
        version INTEGER NOT NULL CHECK (version > 0),
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        description TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('draft', 'finalized')),
        created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
        finalized_at TEXT CHECK (
          finalized_at IS NULL OR finalized_at GLOB '????-??-??T??:??:??.???Z'
        ),
        CHECK (
          (status = 'draft' AND finalized_at IS NULL) OR
          (status = 'finalized' AND finalized_at IS NOT NULL)
        ),
        UNIQUE (dataset_key, version)
      ) STRICT;

      CREATE TABLE dataset_cases (
        id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
        dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
        match_id TEXT NOT NULL CHECK (length(trim(match_id)) > 0),
        target_player_name TEXT NOT NULL CHECK (length(trim(target_player_name)) > 0),
        target_player_puuid TEXT NOT NULL CHECK (length(trim(target_player_puuid)) > 0),
        champion_name TEXT NOT NULL CHECK (length(trim(champion_name)) > 0),
        performance_slice TEXT NOT NULL CHECK (
          performance_slice IN ('great', 'terrible', 'average')
        ),
        style_key TEXT NOT NULL CHECK (length(trim(style_key)) > 0),
        artifact_json TEXT NOT NULL CHECK (json_valid(artifact_json)),
        created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
        CHECK (json_extract(artifact_json, '$.schemaVersion') = 1),
        CHECK (json_extract(artifact_json, '$.matchId') = match_id),
        CHECK (json_extract(artifact_json, '$.targetPlayerName') = target_player_name),
        CHECK (json_extract(artifact_json, '$.targetPlayerPuuid') = target_player_puuid),
        CHECK (json_extract(artifact_json, '$.championName') = champion_name),
        CHECK (json_extract(artifact_json, '$.performanceSlice') = performance_slice),
        CHECK (json_extract(artifact_json, '$.styleKey') = style_key),
        CHECK (length(json_extract(artifact_json, '$.source.matchSha256')) = 64),
        CHECK (length(json_extract(artifact_json, '$.source.timelineSha256')) = 64),
        UNIQUE (dataset_id, ordinal),
        UNIQUE (dataset_id, match_id, target_player_puuid, style_key)
      ) STRICT;

      CREATE TABLE generations (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE CHECK (length(trim(id)) > 0),
        case_id TEXT NOT NULL REFERENCES dataset_cases(id) ON DELETE CASCADE,
        output_text TEXT NOT NULL CHECK (length(trim(output_text)) > 0),
        model TEXT NOT NULL CHECK (length(trim(model)) > 0),
        prompt_revision TEXT NOT NULL CHECK (length(trim(prompt_revision)) > 0),
        duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
        input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
        output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
        created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z')
      ) STRICT;

      CREATE TABLE human_ratings (
        generation_id TEXT PRIMARY KEY REFERENCES generations(id) ON DELETE CASCADE,
        anchoredness INTEGER NOT NULL CHECK (anchoredness BETWEEN 1 AND 3),
        entertainment INTEGER NOT NULL CHECK (entertainment BETWEEN 1 AND 3),
        style_recognizability INTEGER NOT NULL CHECK (style_recognizability BETWEEN 1 AND 3),
        note TEXT NOT NULL CHECK (length(note) <= 2000),
        created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
        updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z')
      ) STRICT;

      CREATE TABLE freshness_ratings (
        dataset_id TEXT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
        style_key TEXT NOT NULL CHECK (length(trim(style_key)) > 0),
        score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 3),
        note TEXT NOT NULL CHECK (length(note) <= 2000),
        created_at TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
        updated_at TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
        PRIMARY KEY (dataset_id, style_key)
      ) STRICT;
    `,
  },
  {
    version: 2,
    name: "finalized_immutability_and_indexes",
    sql: `
      CREATE INDEX dataset_cases_dataset_style_idx
        ON dataset_cases(dataset_id, style_key, ordinal);
      CREATE INDEX generations_case_sequence_idx
        ON generations(case_id, sequence DESC);

      CREATE TRIGGER datasets_prevent_finalized_update
      BEFORE UPDATE ON datasets
      WHEN OLD.status = 'finalized'
      BEGIN
        SELECT RAISE(ABORT, 'finalized dataset is immutable');
      END;

      CREATE TRIGGER datasets_prevent_finalized_delete
      BEFORE DELETE ON datasets
      WHEN OLD.status = 'finalized'
      BEGIN
        SELECT RAISE(ABORT, 'finalized dataset is immutable');
      END;

      CREATE TRIGGER dataset_cases_require_draft_insert
      BEFORE INSERT ON dataset_cases
      WHEN (SELECT status FROM datasets WHERE id = NEW.dataset_id) != 'draft'
      BEGIN
        SELECT RAISE(ABORT, 'cannot add a case to a finalized dataset');
      END;

      CREATE TRIGGER dataset_cases_require_draft_update
      BEFORE UPDATE ON dataset_cases
      WHEN
        (SELECT status FROM datasets WHERE id = OLD.dataset_id) != 'draft' OR
        (SELECT status FROM datasets WHERE id = NEW.dataset_id) != 'draft'
      BEGIN
        SELECT RAISE(ABORT, 'finalized dataset case is immutable');
      END;

      CREATE TRIGGER dataset_cases_require_draft_delete
      BEFORE DELETE ON dataset_cases
      WHEN (SELECT status FROM datasets WHERE id = OLD.dataset_id) != 'draft'
      BEGIN
        SELECT RAISE(ABORT, 'finalized dataset case is immutable');
      END;

      CREATE TRIGGER generations_prevent_update
      BEFORE UPDATE ON generations
      BEGIN
        SELECT RAISE(ABORT, 'generation is immutable');
      END;

      CREATE TRIGGER generations_prevent_delete
      BEFORE DELETE ON generations
      BEGIN
        SELECT RAISE(ABORT, 'generation is immutable');
      END;
    `,
  },
  {
    version: 3,
    name: "generation_rendered_prompts",
    beforeApply: (database) => {
      const { count } = GenerationCountRowSchema.parse(
        database.query("SELECT COUNT(*) AS count FROM generations").get(),
      );
      if (count > 0) {
        throw new Error(
          "Generation prompt migration requires rematerializing existing generations",
        );
      }
    },
    sql: `
      ALTER TABLE generations
      ADD COLUMN rendered_prompts_json TEXT
      CHECK (
        rendered_prompts_json IS NOT NULL
        AND json_valid(rendered_prompts_json)
        AND json_type(rendered_prompts_json) = 'object'
      );
    `,
  },
] as const;

function validateMigrationOrder(): void {
  let expectedVersion = 1;
  for (const migration of MIGRATIONS) {
    if (migration.version !== expectedVersion) {
      throw new Error(`Expected migration version ${String(expectedVersion)}`);
    }
    expectedVersion += 1;
  }
}

export function applyMigrations(database: Database): void {
  validateMigrationOrder();
  database.run(MIGRATION_LEDGER_SQL);

  const appliedRows = z
    .array(MigrationLedgerRowSchema)
    .parse(
      database
        .query("SELECT version, name FROM schema_migrations ORDER BY version")
        .all(),
    );

  for (const applied of appliedRows) {
    const migration = MIGRATIONS.find(
      (candidate) => candidate.version === applied.version,
    );
    if (migration === undefined) {
      throw new Error(
        `Database has unknown migration ${String(applied.version)}`,
      );
    }
    if (migration.name !== applied.name) {
      throw new Error(
        `Migration ${String(applied.version)} name does not match`,
      );
    }
  }

  let expectedAppliedVersion = 1;
  for (const applied of appliedRows) {
    if (applied.version !== expectedAppliedVersion) {
      throw new Error("Migration ledger is not a contiguous ordered prefix");
    }
    expectedAppliedVersion += 1;
  }

  const appliedVersions = new Set(appliedRows.map((row) => row.version));
  for (const migration of MIGRATIONS) {
    if (appliedVersions.has(migration.version)) {
      continue;
    }

    database.transaction(() => {
      migration.beforeApply?.(database);
      database.run(migration.sql);
      database
        .query(
          "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
        )
        .run(migration.version, migration.name, new Date().toISOString());
    })();
  }
}
