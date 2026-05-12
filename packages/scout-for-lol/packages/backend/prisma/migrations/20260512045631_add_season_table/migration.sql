-- CreateTable
CREATE TABLE "Season" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "displayName" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL
);

-- Seed every known season so the FK in the follow-up migration
-- (add_competition_season_relation) has rows to point at for any
-- existing Competition.seasonId values. Values mirror
-- packages/scout-for-lol/packages/data/src/seasons.ts at the time this
-- migration was written; on subsequent bot boots seedSeasons() upserts
-- any drift.
INSERT INTO "Season" ("id", "displayName", "startDate", "endDate") VALUES
    ('2025_SEASON_3_ACT_1', 'Trials of Twilight',  '2025-08-27 07:00:00.000', '2025-10-22 06:59:59.000'),
    ('2025_SEASON_3_ACT_2', 'Worlds 2025',         '2025-10-22 07:00:00.000', '2026-01-08 07:59:59.000'),
    ('2026_SEASON_1_ACT_1', 'For Demacia (Act 1)', '2026-01-09 08:00:00.000', '2026-03-05 07:59:59.000'),
    ('2026_SEASON_1_ACT_2', 'For Demacia (Act 2)', '2026-03-05 08:00:00.000', '2026-04-29 06:59:59.000'),
    ('2026_SEASON_2_ACT_1', 'Pandemonium (Act 1)', '2026-04-29 07:00:00.000', '2026-06-10 06:59:59.000'),
    ('2026_SEASON_2_ACT_2', 'Pandemonium (Act 2)', '2026-06-10 07:00:00.000', '2026-08-13 06:59:59.000');
