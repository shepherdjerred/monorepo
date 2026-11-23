-- Run with the server's bundled Plex SQLite using -readonly -batch -bail -json.
-- Read retained detail and last-watched records in one snapshot.
-- Exact GUID metadata supplies names when they are still available.
-- Stdout contains private watch history. Pipe it to the batch formatter.
WITH legacy_settings AS (
  SELECT
    settings.id,
    settings.account_id,
    settings.guid,
    settings.view_count,
    settings.last_viewed_at,
    CASE
      WHEN settings.guid GLOB 'plex://movie/*' THEN 1
      WHEN settings.guid GLOB 'plex://episode/*' THEN 4
    END AS metadata_kind
  FROM metadata_item_settings AS settings
  WHERE settings.view_count > 0
    AND settings.last_viewed_at IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM metadata_item_views AS exact_view
      WHERE exact_view.account_id = settings.account_id
        AND exact_view.guid = settings.guid
        AND exact_view.metadata_type IN (1, 4)
        AND exact_view.viewed_at >= settings.last_viewed_at
    )
)
SELECT
  'view' AS source,
  id AS sourceViewId,
  CAST(account_id AS TEXT) AS serverAccountId,
  CAST(library_section_id AS TEXT) AS sectionId,
  guid,
  CASE metadata_type WHEN 1 THEN 'movie' WHEN 4 THEN 'episode' END AS kind,
  title,
  grandparent_title AS seriesTitle,
  grandparent_guid AS seriesGuid,
  parent_index AS seasonNumber,
  [index] AS episodeNumber,
  strftime('%Y-%m-%dT%H:%M:%SZ', viewed_at, 'unixepoch') AS viewedAt,
  strftime('%Y-%m-%dT%H:%M:%SZ', originally_available_at, 'unixepoch') AS originallyAvailableAt,
  view_type AS viewType,
  NULL AS viewCount
FROM metadata_item_views
WHERE metadata_type IN (1, 4)

UNION ALL

SELECT
  'last_watched' AS source,
  settings.id AS sourceViewId,
  CAST(settings.account_id AS TEXT) AS serverAccountId,
  CAST(COALESCE(item.library_section_id, detail.library_section_id) AS TEXT) AS sectionId,
  settings.guid,
  CASE settings.metadata_kind WHEN 1 THEN 'movie' WHEN 4 THEN 'episode' END AS kind,
  COALESCE(NULLIF(item.title, ''), detail.title, '') AS title,
  COALESCE(NULLIF(series.title, ''), detail.grandparent_title) AS seriesTitle,
  COALESCE(NULLIF(series.guid, ''), detail.grandparent_guid) AS seriesGuid,
  COALESCE(season.[index], detail.parent_index) AS seasonNumber,
  CASE WHEN settings.metadata_kind = 4
    THEN COALESCE(item.[index], detail.[index])
  END AS episodeNumber,
  strftime('%Y-%m-%dT%H:%M:%SZ', settings.last_viewed_at, 'unixepoch') AS viewedAt,
  COALESCE(
    strftime('%Y-%m-%dT%H:%M:%SZ', item.originally_available_at, 'unixepoch'),
    strftime('%Y-%m-%dT%H:%M:%SZ', detail.originally_available_at, 'unixepoch')
  ) AS originallyAvailableAt,
  NULL AS viewType,
  settings.view_count AS viewCount
FROM legacy_settings AS settings
LEFT JOIN metadata_items AS item ON item.id = (
  SELECT candidate.id
  FROM metadata_items AS candidate
  WHERE candidate.guid = settings.guid
    AND candidate.metadata_type = settings.metadata_kind
  ORDER BY candidate.deleted_at IS NOT NULL, candidate.id DESC
  LIMIT 1
)
LEFT JOIN metadata_items AS season
  ON settings.metadata_kind = 4
    AND season.id = item.parent_id
    AND season.metadata_type = 3
LEFT JOIN metadata_items AS series
  ON series.id = season.parent_id
    AND series.metadata_type = 2
LEFT JOIN metadata_item_views AS detail ON detail.id = (
  SELECT candidate.id
  FROM metadata_item_views AS candidate
  WHERE candidate.guid = settings.guid
    AND candidate.metadata_type = settings.metadata_kind
  ORDER BY candidate.viewed_at DESC, candidate.id DESC
  LIMIT 1
)
WHERE settings.metadata_kind IN (1, 4)
ORDER BY source, sourceViewId;
