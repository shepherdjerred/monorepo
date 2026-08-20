-- Reserve the schema-migration boundary for the release that makes ScoutQL
-- periods mandatory.
--
-- Query text cannot be rewritten safely with SQLite substring operations:
-- clause keywords may appear inside quoted values, and ScoutQL permits
-- arbitrary whitespace between tokens. The backend startup therefore runs
-- scripts/audit-report-windows.ts --fix immediately after `prisma migrate
-- deploy` and before the application starts. That script uses the ScoutQL
-- parser's spans, validates the rewritten plan, and fails startup if any row
-- remains invalid.
--
-- The fixer writes the legacy timestamp predicate rather than DURING syntax,
-- so a rollback to an older image can still parse every rewritten report.

SELECT 1;
