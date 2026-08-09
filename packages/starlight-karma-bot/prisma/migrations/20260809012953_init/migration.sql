-- CreateTable
CREATE TABLE "person" (
    "id" TEXT NOT NULL PRIMARY KEY
);

-- CreateTable
CREATE TABLE "karma" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "amount" INTEGER NOT NULL,
    "datetime" DATETIME NOT NULL,
    "reason" TEXT,
    "guildId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "giverId" TEXT NOT NULL,
    CONSTRAINT "karma_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "person" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "karma_giverId_fkey" FOREIGN KEY ("giverId") REFERENCES "person" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "karma_guildId_receiverId_idx" ON "karma"("guildId", "receiverId");

-- CreateIndex
CREATE INDEX "karma_guildId_giverId_idx" ON "karma"("guildId", "giverId");

-- CreateIndex
CREATE INDEX "karma_guildId_datetime_idx" ON "karma"("guildId", "datetime");
