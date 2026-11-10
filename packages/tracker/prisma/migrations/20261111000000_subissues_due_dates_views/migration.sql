-- AlterTable
ALTER TABLE "Issue" ADD COLUMN "parentId" TEXT,
ADD COLUMN "dueDate" DATE;

-- CreateTable
CREATE TABLE "View" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "teamId" TEXT,
    "position" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "View_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Issue_parentId_idx" ON "Issue"("parentId");

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Issue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "View" ADD CONSTRAINT "View_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "View" ADD CONSTRAINT "View_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Issue" ADD CONSTRAINT "Issue_parent_check" CHECK ("parentId" <> "id");
ALTER TABLE "View" ADD CONSTRAINT "View_params_check" CHECK (jsonb_typeof("params") = 'object');
ALTER TABLE "View" ADD CONSTRAINT "View_position_check" CHECK ("position" >= 0);
