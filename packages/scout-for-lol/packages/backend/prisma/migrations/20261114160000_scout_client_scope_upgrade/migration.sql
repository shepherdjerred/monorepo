-- AlterTable
-- A pairing row with this set is a scope upgrade for an already paired device:
-- approving it adds `scopes` to that device in place instead of issuing a new
-- credential, so the device id, the token and the queued uploads are unchanged.
ALTER TABLE "ScoutClientPairing" ADD COLUMN     "upgradeDeviceId" TEXT;

-- CreateIndex
CREATE INDEX "ScoutClientPairing_upgradeDeviceId_state_idx" ON "ScoutClientPairing"("upgradeDeviceId", "state");

-- AddForeignKey
ALTER TABLE "ScoutClientPairing" ADD CONSTRAINT "ScoutClientPairing_upgradeDeviceId_fkey" FOREIGN KEY ("upgradeDeviceId") REFERENCES "ScoutClientDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
