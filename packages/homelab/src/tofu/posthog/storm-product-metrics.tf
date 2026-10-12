# Minecraft server events are separate from the ts-mc website's browser identity.
# Keep this dashboard private and production-only; use an ad-hoc beta query for acceptance.
locals {
  storm_events = <<-SQL
    SELECT DISTINCT properties.event_id AS event_id, distinct_id, timestamp, event,
      properties.mode AS mode, properties.feature AS feature, properties.action AS action,
      toFloat(properties.connected_ms) AS connected_ms,
      toFloat(properties.active_ms) AS active_ms,
      properties.first_seen_at AS first_seen_at
    FROM events
    WHERE event IN ('storm_session_started', 'storm_playtime_recorded', 'storm_feature_interacted', 'storm_session_ended')
      AND properties.source = 'minecraft' AND properties.site_key = 'ts-mc'
      AND properties.stage = 'prod' AND properties.schema_version = 1
      AND properties.event_id IS NOT NULL AND {filters}
  SQL

  storm_metrics = {
    active_players = {
      name        = "Unique players: daily, weekly, monthly"
      description = "Players seen in the last 1, 7 and 30 days, including connections spanning midnight."
      display     = "ActionsTable"
      query       = "SELECT uniqIf(distinct_id, timestamp >= now() - INTERVAL 1 DAY) AS daily_players, uniqIf(distinct_id, timestamp >= now() - INTERVAL 7 DAY) AS weekly_players, uniqIf(distinct_id, timestamp >= now() - INTERVAL 30 DAY) AS monthly_players FROM (${local.storm_events})"
    }
    new_returning = {
      name        = "Daily new and returning players"
      description = "New means first seen by this collector; historical server visits are not backfilled. Pacific calendar days."
      display     = "ActionsLineGraph"
      query       = "SELECT toDate(toTimeZone(timestamp, 'America/Los_Angeles')) AS day, uniqIf(distinct_id, toDate(toTimeZone(parseDateTimeBestEffort(first_seen_at), 'America/Los_Angeles')) = day) AS new_players, uniqIf(distinct_id, toDate(toTimeZone(parseDateTimeBestEffort(first_seen_at), 'America/Los_Angeles')) < day) AS returning_players FROM (${local.storm_events}) GROUP BY day ORDER BY day"
    }
    playtime = {
      name        = "Daily connected and active hours"
      description = "Active time excludes Essentials AFK. Intervals are split at Pacific midnight; session summaries are excluded from sums."
      display     = "ActionsLineGraph"
      query       = "SELECT toDate(toTimeZone(timestamp, 'America/Los_Angeles')) AS day, sum(connected_ms) / 3600000 AS connected_hours, sum(active_ms) / 3600000 AS active_hours FROM (${local.storm_events}) WHERE event = 'storm_playtime_recorded' GROUP BY day ORDER BY day"
    }
    modes = {
      name        = "Playtime by mode"
      description = "Survival, arenas and Search and Destroy, including accepted lobby and spectator membership."
      display     = "ActionsTable"
      query       = "SELECT mode, sum(connected_ms) / 3600000 AS connected_hours, sum(active_ms) / 3600000 AS active_hours, uniq(distinct_id) AS unique_players FROM (${local.storm_events}) WHERE event = 'storm_playtime_recorded' GROUP BY mode ORDER BY connected_hours DESC"
    }
    sessions = {
      name        = "Completed sessions"
      description = "Mean connected and active minutes, including shutdown and crash recovery only through the last durable checkpoint. Open sessions are excluded."
      display     = "ActionsTable"
      query       = "SELECT count() AS sessions, avg(connected_ms) / 60000 AS mean_connected_minutes, avg(active_ms) / 60000 AS mean_active_minutes FROM (${local.storm_events}) WHERE event = 'storm_session_ended'"
    }
    features = {
      name        = "Features: interactions and unique players"
      description = "Successful feature interactions by bounded action. Arena/match completion includes forced stops. No command arguments or chat content."
      display     = "ActionsTable"
      query       = "SELECT feature, action, count() AS interactions, uniq(distinct_id) AS unique_players FROM (${local.storm_events}) WHERE event = 'storm_feature_interacted' GROUP BY feature, action ORDER BY unique_players DESC, interactions DESC"
    }
    retention = {
      name        = "New player retention: following week"
      description = "Pacific Monday cohorts of players first seen by analytics. Shows only cohorts whose entire following week has elapsed."
      display     = "ActionsTable"
      query       = <<-SQL
        WITH measured AS (${local.storm_events}),
        cohorts AS (
          SELECT distinct_id, min(toStartOfWeek(toTimeZone(parseDateTimeBestEffort(first_seen_at), 'America/Los_Angeles'), 1)) AS cohort
          FROM measured
          WHERE event = 'storm_session_started'
            AND toDate(toTimeZone(timestamp, 'America/Los_Angeles')) = toDate(toTimeZone(parseDateTimeBestEffort(first_seen_at), 'America/Los_Angeles'))
          GROUP BY distinct_id
        ), weeks AS (
          SELECT DISTINCT distinct_id, toStartOfWeek(toTimeZone(timestamp, 'America/Los_Angeles'), 1) AS week FROM measured
        )
        SELECT cohorts.cohort AS cohort_week, uniq(cohorts.distinct_id) AS new_players,
          uniqIf(cohorts.distinct_id, weeks.week = cohorts.cohort + INTERVAL 7 DAY) AS returned_next_week,
          100.0 * returned_next_week / new_players AS retention_percent
        FROM cohorts LEFT JOIN weeks ON cohorts.distinct_id = weeks.distinct_id
        WHERE cohorts.cohort < toStartOfWeek(toTimeZone(now(), 'America/Los_Angeles'), 1) - INTERVAL 7 DAY
        GROUP BY cohort_week ORDER BY cohort_week
      SQL
    }
  }
}

resource "posthog_dashboard" "storm_product_metrics" {
  deleted     = false
  description = "Private Minecraft product metrics for The Storm. Production human players only. Named Minecraft identities; no chat, commands, IP addresses or replay."
  name        = "The Storm — Product Metrics"
  pinned      = false
  project_id  = "549883"
  tags        = null
}

resource "posthog_insight" "storm_product_metrics" {
  for_each         = local.storm_metrics
  create_in_folder = null
  dashboard_ids    = [tonumber(posthog_dashboard.storm_product_metrics.id)]
  deleted          = false
  derived_name     = null
  description      = each.value.description
  name             = each.value.name
  project_id       = "549883"
  query_json = jsonencode({
    kind    = "DataVisualizationNode"
    display = each.value.display
    source = {
      kind    = "HogQLQuery"
      query   = each.value.query
      filters = { dateRange = { date_from = "-90d", date_to = null } }
    }
  })
  query_sql = null
  tags      = null
}
