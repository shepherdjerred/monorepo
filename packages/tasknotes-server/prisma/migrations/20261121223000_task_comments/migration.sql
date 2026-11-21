CREATE TABLE "TaskComment" (
    "taskId" TEXT NOT NULL REFERENCES "Task"("id") ON DELETE CASCADE,
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "fileName" TEXT,
    "attachment" BYTEA,
    PRIMARY KEY ("taskId", "id")
);
CREATE INDEX "TaskComment_taskId_createdAt_idx" ON "TaskComment"("taskId","createdAt");
