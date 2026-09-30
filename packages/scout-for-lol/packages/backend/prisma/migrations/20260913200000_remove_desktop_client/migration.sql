BEGIN;

DO $$
DECLARE
  desktop_table text;
  has_rows boolean;
BEGIN
  FOREACH desktop_table IN ARRAY ARRAY[
    'ApiToken',
    'DesktopClient',
    'SoundPack',
    'StoredSound',
    'GameEventLog'
  ] LOOP
    IF to_regclass(format('public.%I', desktop_table)) IS NOT NULL THEN
      EXECUTE format(
        'LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE',
        desktop_table
      );
      EXECUTE format(
        'SELECT EXISTS (SELECT FROM public.%I)',
        desktop_table
      ) INTO has_rows;
      IF has_rows THEN
        RAISE EXCEPTION
          'Cannot remove Scout Desktop tables while desktop data exists; re-run the retirement inventory and remove stored sound objects first.';
      END IF;
    END IF;
  END LOOP;
END $$;

DROP TABLE IF EXISTS "GameEventLog";
DROP TABLE IF EXISTS "DesktopClient";
DROP TABLE IF EXISTS "StoredSound";
DROP TABLE IF EXISTS "SoundPack";
DROP TABLE IF EXISTS "ApiToken";

COMMIT;
