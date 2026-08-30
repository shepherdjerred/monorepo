-- A durable claim is written before Tournament-V5 code creation. If the POST
-- has an ambiguous outcome, the claim prevents an automatic second mint.
CREATE TABLE "TournamentLobbyProvision" (
    "id" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "lobbyId" INTEGER,
    "lastError" TEXT,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentLobbyProvision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TournamentLobbyProvision_lobbyId_key"
ON "TournamentLobbyProvision"("lobbyId");

CREATE INDEX "TournamentLobbyProvision_state_claimedAt_idx"
ON "TournamentLobbyProvision"("state", "claimedAt");

CREATE INDEX "TournamentLobbyProvision_requestHash_state_idx"
ON "TournamentLobbyProvision"("requestHash", "state");

-- Discord assigns a new interaction ID when a user repeats a slash command.
-- Keep equivalent unresolved work globally unique so a retry cannot mint a
-- second Riot credential after an ambiguous first response. COMPLETED claims
-- are excluded so a genuinely new lobby with the same roster remains valid.
CREATE UNIQUE INDEX "TournamentLobbyProvision_unresolved_requestHash_key"
ON "TournamentLobbyProvision"("requestHash")
WHERE "state" IN ('PENDING', 'AMBIGUOUS');

ALTER TABLE "TournamentLobbyProvision"
ADD CONSTRAINT "TournamentLobbyProvision_lobbyId_fkey"
FOREIGN KEY ("lobbyId") REFERENCES "TournamentLobby"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
