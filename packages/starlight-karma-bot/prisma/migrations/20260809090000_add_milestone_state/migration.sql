-- CreateTable
CREATE TABLE "milestone_state" (
    "guildId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "highestAnnounced" INTEGER NOT NULL,

    PRIMARY KEY ("guildId", "receiverId"),
    CONSTRAINT "milestone_state_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "person" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Seed each receiver's durable high-water mark from their historical running
-- balance. Using the maximum running total, rather than the current total,
-- preserves milestones that were crossed before a later penalty or undo.
WITH "running_totals" AS (
    SELECT
        "guildId",
        "receiverId",
        SUM("amount") OVER (
            PARTITION BY "guildId", "receiverId"
            ORDER BY "datetime", "id"
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS "runningTotal"
    FROM "karma"
),
"high_water" AS (
    SELECT
        "guildId",
        "receiverId",
        MAX("runningTotal") AS "highWater"
    FROM "running_totals"
    GROUP BY "guildId", "receiverId"
)
INSERT INTO "milestone_state" ("guildId", "receiverId", "highestAnnounced")
SELECT
    "guildId",
    "receiverId",
    CASE
        WHEN "highWater" >= 500 THEN 500
        WHEN "highWater" >= 250 THEN 250
        WHEN "highWater" >= 100 THEN 100
        WHEN "highWater" >= 50 THEN 50
        WHEN "highWater" >= 25 THEN 25
        ELSE 10
    END
FROM "high_water"
WHERE "highWater" >= 10;
