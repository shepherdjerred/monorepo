-- Mark synthetic per-server house wallets without changing existing user
-- account identities. House accounts use a reserved synthetic Discord ID, are
-- excluded from user-facing leaderboards, and remain fully auditable.
ALTER TABLE "BucksAccount" ADD COLUMN "isHouse" BOOLEAN NOT NULL DEFAULT false;
