CREATE TYPE "RecurrenceBasis" AS ENUM ('Scheduled', 'Completion');
ALTER TABLE "Task"
  ADD COLUMN "deadline" DATE,
  ADD COLUMN "recurrenceBasis" "RecurrenceBasis";
