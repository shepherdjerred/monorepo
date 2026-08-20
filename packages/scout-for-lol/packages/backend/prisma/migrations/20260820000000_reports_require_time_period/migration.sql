-- Give every stored report an explicit time period, before ScoutQL starts
-- requiring one.
--
-- Three things about this migration are deliberate.
--
-- 1. It writes the legacy WHERE predicate, NOT the new DURING clause. That text
--    is a no-op for every already-released image -- 30 days was the default
--    anyway -- and it satisfies the new requirement. So rolling the deploy back
--    cannot strand a migrated row on syntax its parser does not know. Writing
--    DURING here would make an older parser swallow it into the GROUP BY slice
--    and fail every migrated report with "Unknown GROUP BY field".
--
-- 2. Offsets are computed against a whitespace-normalized copy and applied to
--    the original with substr(). Each replace() below maps one character to one
--    character, so the offsets are identical in both. This matters because
--    stored query text is frequently multi-line -- the report editor writes
--    formatReportQuery output straight into this column -- and matching
--    ' group by ' against raw text misses every formatted row.
--
-- 3. There is no aborting guard table, unlike the 2026-07 bounds migration.
--    `prisma migrate deploy` runs before the app starts, so a migration that
--    aborts crash-loops the pod and leaves a failed row in _prisma_migrations
--    needing a manual `prisma migrate resolve`. Rows this cannot convert are
--    reported by scripts/audit-report-windows.ts instead, which is run against
--    a snapshot before the deploy rather than discovered during it.
--
-- Rows already carrying a period are skipped: an explicit lookback predicate, a
-- DURING clause, or an ANALYZE clause (which states its own window, and which
-- a lookback predicate may not be combined with).
--
-- LIMITATION, deliberate and covered by the audit: instr() finds the FIRST
-- ' group by ', which is the wrong offset for a query whose quoted text
-- contains that phrase (a chart title, say), and it matches only the
-- single-spaced form, so `GROUP  BY` or a tab is skipped. Both are rare, and a
-- skipped row simply stays unmigrated rather than becoming wrong.
-- scripts/audit-report-windows.ts re-parses every row afterwards with the real
-- parser, reports anything this missed or mangled, and exits nonzero; its
-- --fix splices at the parser's own clause span, which has neither weakness.
-- Run the audit AFTER the migration, not only before it.

UPDATE "Report"
SET "queryText" =
  substr(
    "queryText",
    1,
    instr(
      replace(replace(replace(lower("queryText"), char(10), ' '), char(13), ' '), char(9), ' '),
      ' group by '
    ) - 1
  ) ||
  CASE
    WHEN instr(
      replace(replace(replace(lower("queryText"), char(10), ' '), char(13), ' '), char(9), ' '),
      ' where '
    ) > 0 THEN ' AND '
    ELSE ' WHERE '
  END ||
  CASE
    WHEN instr(
      replace(replace(replace(lower("queryText"), char(10), ' '), char(13), ' '), char(9), ' '),
      ' from prematch_participants '
    ) > 0 THEN 'observed_at'
    ELSE 'game_creation_at'
  END ||
  ' >= CURRENT_TIMESTAMP - INTERVAL ''30 days'' ' ||
  substr(
    "queryText",
    instr(
      replace(replace(replace(lower("queryText"), char(10), ' '), char(13), ' '), char(9), ' '),
      ' group by '
    ) + 1
  )
WHERE instr(
    replace(replace(replace(lower("queryText"), char(10), ' '), char(13), ' '), char(9), ' '),
    ' group by '
  ) > 0
  AND instr(
    replace(replace(replace(lower("queryText"), char(10), ' '), char(13), ' '), char(9), ' '),
    ' current_timestamp '
  ) = 0
  AND instr(
    replace(replace(replace(lower("queryText"), char(10), ' '), char(13), ' '), char(9), ' '),
    ' analyze '
  ) = 0
  AND instr(
    replace(replace(replace(lower("queryText"), char(10), ' '), char(13), ' '), char(9), ' '),
    ' during '
  ) = 0;
