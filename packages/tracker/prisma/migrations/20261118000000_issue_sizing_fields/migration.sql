-- CreateEnum
CREATE TYPE "Urgency" AS ENUM ('high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "Impact" AS ENUM ('high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "Effort" AS ENUM ('xs', 's', 'm', 'l', 'xl');

-- AlterTable
ALTER TABLE "Issue" ADD COLUMN "priorityManual" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "urgency" "Urgency",
ADD COLUMN "impact" "Impact",
ADD COLUMN "effort" "Effort";

-- Preserve existing explicit priorities until auto mode is opted into
UPDATE "Issue" SET "priorityManual" = true WHERE "priority" > 0;
