# Scout feature usage — the standing answer to "which features are actually
# used, and how much". Collected events had no dashboard before this: every
# report/competition/Explore/profile SPA event, discord_command_used, and
# voice_question_asked flowed to PostHog without a single insight over them.

resource "posthog_dashboard" "scout_feature_usage" {
  deleted     = false
  description = "Which Scout features are actually used: progression actions, creation/usage events, Discord commands by name and subcommand, and voice questions."
  name        = "Scout Feature Usage"
  pinned      = false
  project_id  = "549883"
  tags        = null
}

resource "posthog_insight" "scout_progression_actions_weekly" {
  create_in_folder = null
  dashboard_ids    = [tonumber(posthog_dashboard.scout_feature_usage.id)]
  deleted          = false
  derived_name     = null
  description      = "Hall of Fame, challenge, and duel actions per week — the previously uninstrumented features."
  name             = "Progression feature actions (weekly)"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      dateRange = {
        date_from                = "-90d"
        excludeIncompletePeriods = false
        explicitDate             = false
      }
      filterTestAccounts = false
      interval           = "week"
      kind               = "TrendsQuery"
      properties         = []
      series = [
        {
          event = "hall_record_broken"
          kind  = "EventsNode"
          name  = "hall_record_broken"
        },
        {
          event = "hall_settings_changed"
          kind  = "EventsNode"
          name  = "hall_settings_changed"
        },
        {
          event = "challenge_run_started"
          kind  = "EventsNode"
          name  = "challenge_run_started"
        },
        {
          event = "challenge_template_published"
          kind  = "EventsNode"
          name  = "challenge_template_published"
        },
        {
          event = "duel_challenge_issued"
          kind  = "EventsNode"
          name  = "duel_challenge_issued"
        },
        {
          event = "duel_event_created"
          kind  = "EventsNode"
          name  = "duel_event_created"
        },
      ]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsLineGraph"
        showAlertThresholdLines = false
        showLegend              = true
        showPercentStackView    = false
        showValuesOnSeries      = false
        smoothingIntervals      = 1
        yAxisScaleType          = "linear"
      }
    }
  })
  query_sql = null
  tags      = null
}

resource "posthog_insight" "scout_creation_usage_weekly" {
  create_in_folder = null
  dashboard_ids    = [tonumber(posthog_dashboard.scout_feature_usage.id)]
  deleted          = false
  derived_name     = null
  description      = "Creation and consumption events that were collected but never charted: reports, competitions, Explore turns, profile opens."
  name             = "Creation and usage events (weekly)"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      dateRange = {
        date_from                = "-90d"
        excludeIncompletePeriods = false
        explicitDate             = false
      }
      filterTestAccounts = false
      interval           = "week"
      kind               = "TrendsQuery"
      properties         = []
      series = [
        {
          event = "report_created"
          kind  = "EventsNode"
          name  = "report_created"
        },
        {
          event = "report_run"
          kind  = "EventsNode"
          name  = "report_run"
        },
        {
          event = "competition_created"
          kind  = "EventsNode"
          name  = "competition_created"
        },
        {
          event = "explore_turn_finished"
          kind  = "EventsNode"
          name  = "explore_turn_finished"
        },
        {
          event = "player_profile_opened"
          kind  = "EventsNode"
          name  = "player_profile_opened"
        },
      ]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsLineGraph"
        showAlertThresholdLines = false
        showLegend              = true
        showPercentStackView    = false
        showValuesOnSeries      = false
        smoothingIntervals      = 1
        yAxisScaleType          = "linear"
      }
    }
  })
  query_sql = null
  tags      = null
}

resource "posthog_insight" "scout_discord_commands_by_name" {
  create_in_folder = null
  dashboard_ids    = [tonumber(posthog_dashboard.scout_feature_usage.id)]
  deleted          = false
  derived_name     = null
  description      = "Which slash commands members actually run."
  name             = "Discord commands by name (weekly)"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown      = "command_name"
        breakdown_type = "event"
      }
      dateRange = {
        date_from                = "-90d"
        excludeIncompletePeriods = false
        explicitDate             = false
      }
      filterTestAccounts = false
      interval           = "week"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        event = "discord_command_used"
        kind  = "EventsNode"
        name  = "discord_command_used"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsStackedBar"
        showAlertThresholdLines = false
        showLegend              = true
        showPercentStackView    = false
        showValuesOnSeries      = false
        smoothingIntervals      = 1
        yAxisScaleType          = "linear"
      }
    }
  })
  query_sql = null
  tags      = null
}

resource "posthog_insight" "scout_bb_by_subcommand" {
  create_in_folder = null
  dashboard_ids    = [tonumber(posthog_dashboard.scout_feature_usage.id)]
  deleted          = false
  derived_name     = null
  description      = "Bryan Bucks command usage split by subcommand (balance, history, dare, transfer, …)."
  name             = "/bb usage by subcommand (weekly)"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown      = "subcommand"
        breakdown_type = "event"
      }
      dateRange = {
        date_from                = "-90d"
        excludeIncompletePeriods = false
        explicitDate             = false
      }
      filterTestAccounts = false
      interval           = "week"
      kind               = "TrendsQuery"
      properties = {
        type = "AND"
        values = [{
          type = "AND"
          values = [{
            key      = "command_name"
            operator = "exact"
            type     = "event"
            value    = ["bb"]
          }]
        }]
      }
      series = [{
        event = "discord_command_used"
        kind  = "EventsNode"
        name  = "discord_command_used"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsStackedBar"
        showAlertThresholdLines = false
        showLegend              = true
        showPercentStackView    = false
        showValuesOnSeries      = false
        smoothingIntervals      = 1
        yAxisScaleType          = "linear"
      }
    }
  })
  query_sql = null
  tags      = null
}

resource "posthog_insight" "scout_voice_questions_by_outcome" {
  create_in_folder = null
  dashboard_ids    = [tonumber(posthog_dashboard.scout_feature_usage.id)]
  deleted          = false
  derived_name     = null
  description      = "Hey Scout voice questions split by turn outcome."
  name             = "Voice questions by outcome (weekly)"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown      = "outcome"
        breakdown_type = "event"
      }
      dateRange = {
        date_from                = "-90d"
        excludeIncompletePeriods = false
        explicitDate             = false
      }
      filterTestAccounts = false
      interval           = "week"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        event = "voice_question_asked"
        kind  = "EventsNode"
        name  = "voice_question_asked"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsStackedBar"
        showAlertThresholdLines = false
        showLegend              = true
        showPercentStackView    = false
        showValuesOnSeries      = false
        smoothingIntervals      = 1
        yAxisScaleType          = "linear"
      }
    }
  })
  query_sql = null
  tags      = null
}
