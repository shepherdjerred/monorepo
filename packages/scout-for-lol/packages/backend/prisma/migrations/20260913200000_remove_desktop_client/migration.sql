BEGIN;

LOCK TABLE "ApiToken" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "DesktopClient" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "SoundPack" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "StoredSound" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "GameEventLog" IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (SELECT FROM "ApiToken")
    OR EXISTS (SELECT FROM "DesktopClient")
    OR EXISTS (SELECT FROM "SoundPack")
    OR EXISTS (SELECT FROM "StoredSound")
    OR EXISTS (SELECT FROM "GameEventLog") THEN
    RAISE EXCEPTION
      'Cannot remove Scout Desktop tables while desktop data exists; re-run the retirement inventory and remove stored sound objects first.';
  END IF;
END $$;

DROP TABLE "GameEventLog";
DROP TABLE "DesktopClient";
DROP TABLE "StoredSound";
DROP TABLE "SoundPack";
DROP TABLE "ApiToken";

COMMIT;
