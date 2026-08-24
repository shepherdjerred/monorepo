# __generated__ by OpenTofu
# Please review these resources and move them into your main configuration files.

# __generated__ by OpenTofu from "549883/10881555"
resource "posthog_insight" "insight_10881555" {
  create_in_folder = null
  dashboard_ids    = [1975723]
  deleted          = false
  derived_name     = null
  description      = "How many people come back week after week after their first visit. The clearest signal of whether your product is sticky."
  name             = "Retention"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      dateRange = {
        date_from    = "-7d"
        explicitDate = false
      }
      filterTestAccounts = false
      kind               = "RetentionQuery"
      properties         = []
      retentionFilter = {
        period        = "Week"
        retentionType = "retention_first_time"
        returningEntity = {
          id   = "$pageview"
          type = "events"
        }
        targetEntity = {
          id   = "$pageview"
          type = "events"
        }
        totalIntervals = 11
      }
    }
  })
  query_sql = null
  tags      = null
}

# __generated__ by OpenTofu from "549883/10892235"
resource "posthog_insight" "insight_10892235" {
  create_in_folder = null
  dashboard_ids    = [1977280]
  deleted          = false
  derived_name     = null
  description      = null
  name             = "Pages Per User"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown_type = "event"
      }
      dateRange = {
        date_from    = "-30d"
        explicitDate = false
      }
      filterTestAccounts = false
      interval           = "week"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        event = "$pageview"
        kind  = "EventsNode"
        math  = "total"
        name  = "$pageview"
        }, {
        event = "$pageview"
        kind  = "EventsNode"
        math  = "dau"
        name  = "$pageview"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsLineGraph"
        formula                 = "A/B"
        showAlertThresholdLines = false
        showLegend              = false
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

# __generated__ by OpenTofu from "549883/11297195"
resource "posthog_insight" "insight_11297195" {
  create_in_folder = null
  dashboard_ids    = [2027696]
  deleted          = false
  derived_name     = null
  description      = "Daily unique non-house Bucks members with activity."
  name             = "Bryan Bucks daily active members"
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
      interval           = "day"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        event = "bryan_bucks_member_activity"
        kind  = "EventsNode"
        math  = "dau"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsLineGraph"
        excludeBoxPlotOutliers  = true
        hideWeekends            = false
        legendPosition          = "bottom"
        metricColorByDirection  = false
        metricShowChange        = true
        metricSummary           = "total"
        resultCustomizationBy   = "value"
        showAlertThresholdLines = false
        showAnnotations         = true
        showLegend              = false
        showMultipleYAxes       = false
        showPercentStackView    = false
        showValuesOnSeries      = false
        smoothingIntervals      = 1
        stackBreakdownValues    = false
        yAxisScaleType          = "linear"
        yAxisStartAtZero        = true
      }
    }
  })
  query_sql = null
  tags      = null
}

# __generated__ by OpenTofu from "549883/10881550"
resource "posthog_insight" "insight_10881550" {
  create_in_folder = null
  dashboard_ids    = [1975723]
  deleted          = false
  derived_name     = null
  description      = "Unique people who used your app in the last 30 days. A quick pulse on your overall reach."
  name             = "Active users (last 30 days)"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown_type = "event"
      }
      dateRange = {
        date_from    = "-30d"
        explicitDate = false
      }
      filterTestAccounts = false
      interval           = "day"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        kind = "GroupNode"
        math = "dau"
        name = "Pageview or screen"
        nodes = [{
          event = "$pageview"
          kind  = "EventsNode"
          name  = "$pageview"
          }, {
          event = "$screen"
          kind  = "EventsNode"
          name  = "$screen"
        }]
        operator = "OR"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "BoldNumber"
        showAlertThresholdLines = false
        showLegend              = false
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

# __generated__ by OpenTofu from "549883/10881554"
resource "posthog_insight" "insight_10881554" {
  create_in_folder = null
  dashboard_ids    = [1975723]
  deleted          = false
  derived_name     = null
  description      = "Unique people who use your app each week. Smooths out daily noise to show the underlying trend."
  name             = "Weekly active users (WAUs)"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown_type = "event"
      }
      dateRange = {
        date_from    = "-90d"
        explicitDate = false
      }
      filterTestAccounts = false
      interval           = "week"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        kind = "GroupNode"
        math = "dau"
        name = "Pageview or screen"
        nodes = [{
          event = "$pageview"
          kind  = "EventsNode"
          name  = "$pageview"
          }, {
          event = "$screen"
          kind  = "EventsNode"
          name  = "$screen"
        }]
        operator = "OR"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsLineGraph"
        showAlertThresholdLines = false
        showLegend              = false
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

# __generated__ by OpenTofu from "549883/11297213"
resource "posthog_insight" "insight_11297213" {
  create_in_folder = null
  dashboard_ids    = [2027696]
  deleted          = false
  derived_name     = null
  description      = "Deduplicated daily economy snapshot count; a missing current-day point indicates stale telemetry."
  name             = "Bryan Bucks snapshot freshness"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      dateRange = {
        date_from                = "-30d"
        excludeIncompletePeriods = false
        explicitDate             = false
      }
      filterTestAccounts = false
      interval           = "day"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        event      = "bryan_bucks_economy_snapshot"
        kind       = "EventsNode"
        math       = "hogql"
        math_hogql = "count(distinct uuid)"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsBar"
        excludeBoxPlotOutliers  = true
        hideWeekends            = false
        legendPosition          = "bottom"
        metricColorByDirection  = false
        metricShowChange        = true
        metricSummary           = "total"
        resultCustomizationBy   = "value"
        showAlertThresholdLines = false
        showAnnotations         = true
        showLegend              = false
        showMultipleYAxes       = false
        showPercentStackView    = false
        showValuesOnSeries      = false
        smoothingIntervals      = 1
        stackBreakdownValues    = false
        yAxisScaleType          = "linear"
        yAxisStartAtZero        = true
      }
    }
  })
  query_sql = null
  tags      = null
}

# __generated__ by OpenTofu from "019fe7f8-ecce-0000-adca-fe93618022c7/549883"
resource "posthog_project" "monorepo" {
  name            = "monorepo"
  organization_id = "019fe7f8-ecce-0000-adca-fe93618022c7"
  timezone        = "America/Los_Angeles"

  lifecycle {
    prevent_destroy = true
  }
}

# __generated__ by OpenTofu from "549883/1977280"
resource "posthog_dashboard" "dashboard_1977280" {
  deleted     = false
  description = "Understand how many users are visiting your website, the most popular pages, and in which countries is your website being visited from."
  name        = "Website Metrics"
  pinned      = false
  project_id  = "549883"
  tags        = null
}

# __generated__ by OpenTofu from "549883/1977280"
resource "posthog_dashboard_layout" "dashboard_1977280" {
  dashboard_id = 1977280
  project_id   = "549883"
  tiles = [
    {
      color      = "blue"
      insight_id = 10892230
      layouts_json = jsonencode({
        sm = {
          h    = 5
          i    = "21"
          minH = 5
          minW = 3
          w    = 6
          x    = 0
          y    = 0
        }
        xs = {
          h    = 5
          i    = "21"
          minH = 5
          minW = 1
          w    = 1
          x    = 0
          y    = 0
        }
      })
      show_description = null
      text_body        = null
    },
    {
      color      = "green"
      insight_id = 10892231
      layouts_json = jsonencode({
        sm = {
          h    = 5
          i    = "22"
          minH = 5
          minW = 3
          w    = 6
          x    = 6
          y    = 0
        }
        xs = {
          h    = 5
          i    = "22"
          minH = 5
          minW = 1
          w    = 1
          x    = 0
          y    = 5
        }
      })
      show_description = null
      text_body        = null
    },
    {
      color      = "blue"
      insight_id = 10892232
      layouts_json = jsonencode({
        sm = {
          h    = 5
          i    = "23"
          minH = 5
          minW = 3
          w    = 6
          x    = 0
          y    = 5
        }
        xs = {
          h    = 5
          i    = "23"
          minH = 5
          minW = 1
          w    = 1
          x    = 0
          y    = 10
        }
      })
      show_description = null
      text_body        = null
    },
    {
      color      = "green"
      insight_id = 10892233
      layouts_json = jsonencode({
        sm = {
          h    = 5
          i    = "24"
          minH = 5
          minW = 3
          w    = 6
          x    = 6
          y    = 5
        }
        xs = {
          h    = 5
          i    = "24"
          minH = 5
          minW = 1
          w    = 1
          x    = 0
          y    = 15
        }
      })
      show_description = null
      text_body        = null
    },
    {
      color      = null
      insight_id = 10892234
      layouts_json = jsonencode({
        sm = {
          h    = 5
          i    = "25"
          minH = 5
          minW = 3
          w    = 6
          x    = 0
          y    = 10
        }
        xs = {
          h    = 5
          i    = "25"
          minH = 5
          minW = 1
          w    = 1
          x    = 0
          y    = 20
        }
      })
      show_description = null
      text_body        = null
    },
    {
      color      = null
      insight_id = 10892235
      layouts_json = jsonencode({
        sm = {
          h    = 5
          i    = "26"
          minH = 5
          minW = 3
          w    = 6
          x    = 6
          y    = 10
        }
        xs = {
          h    = 5
          i    = "26"
          minH = 5
          minW = 1
          w    = 1
          x    = 0
          y    = 25
        }
      })
      show_description = null
      text_body        = null
    },
    {
      color      = "black"
      insight_id = 10892236
      layouts_json = jsonencode({
        sm = {
          h    = 8
          i    = "27"
          minH = 5
          minW = 3
          w    = 6
          x    = 0
          y    = 15
        }
        xs = {
          h    = 5
          i    = "27"
          minH = 5
          minW = 1
          w    = 1
          x    = 0
          y    = 30
        }
      })
      show_description = null
      text_body        = null
    },
    {
      color      = "black"
      insight_id = 10892237
      layouts_json = jsonencode({
        sm = {
          h    = 8
          i    = "28"
          minH = 5
          minW = 3
          w    = 6
          x    = 6
          y    = 15
        }
        xs = {
          h    = 5
          i    = "28"
          minH = 5
          minW = 1
          w    = 1
          x    = 0
          y    = 35
        }
      })
      show_description = null
      text_body        = null
    },
    {
      color      = null
      insight_id = 10892238
      layouts_json = jsonencode({
        sm = {
          h    = 8
          i    = "29"
          minH = 5
          minW = 3
          w    = 12
          x    = 0
          y    = 23
        }
        xs = {
          h    = 5
          i    = "29"
          minH = 5
          minW = 1
          w    = 1
          x    = 0
          y    = 40
        }
      })
      show_description = null
      text_body        = null
    },
  ]
}

# __generated__ by OpenTofu from "549883/10881557"
resource "posthog_insight" "insight_10881557" {
  create_in_folder = null
  dashboard_ids    = [1975723]
  deleted          = false
  derived_name     = null
  description      = "Of people who land on a page, how many go on to interact. Replace these steps with your own events to track real conversions."
  name             = "Visit to interaction funnel"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown_type = "event"
      }
      dateRange = {
        date_from    = "-7d"
        explicitDate = false
      }
      filterTestAccounts = false
      funnelsFilter = {
        breakdownAttributionType = "first_touch"
        exclusions               = []
        funnelOrderType          = "ordered"
        funnelStepReference      = "total"
        funnelVizType            = "steps"
        funnelWindowInterval     = 14
        funnelWindowIntervalUnit = "day"
        layout                   = "horizontal"
      }
      interval   = "day"
      kind       = "FunnelsQuery"
      properties = []
      series = [{
        custom_name = "Viewed a page"
        event       = "$pageview"
        kind        = "EventsNode"
        name        = "$pageview"
        }, {
        custom_name = "Clicked something"
        event       = "$autocapture"
        kind        = "EventsNode"
        name        = "$autocapture"
      }]
    }
  })
  query_sql = null
  tags      = null
}

# __generated__ by OpenTofu from "549883/10892226"
resource "posthog_insight" "insight_10892226" {
  create_in_folder = null
  dashboard_ids    = [1977279]
  deleted          = false
  derived_name     = null
  description      = "How many of your users are new, returning, resurrecting, or dormant each week."
  name             = "Growth accounting"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      dateRange = {
        date_from    = "-30d"
        explicitDate = false
      }
      filterTestAccounts = false
      interval           = "week"
      kind               = "LifecycleQuery"
      lifecycleFilter = {
        showLegend = false
      }
      properties = []
      series = [{
        event = "$pageview"
        kind  = "EventsNode"
        name  = "$pageview"
      }]
    }
  })
  query_sql = null
  tags      = null
}

# __generated__ by OpenTofu from "019fe7f8-ecce-0000-adca-fe93618022c7/019fea37-95d4-0000-a853-32ba533f6f8c"
resource "posthog_proxy_record" "j_sjer_red" {
  domain          = "j.sjer.red"
  organization_id = "019fe7f8-ecce-0000-adca-fe93618022c7"

  lifecycle {
    prevent_destroy = true
  }
}

# __generated__ by OpenTofu from "549883/10892238"
resource "posthog_insight" "insight_10892238" {
  create_in_folder = null
  dashboard_ids    = [1977280]
  deleted          = false
  derived_name     = null
  description      = null
  name             = "Website Users by Location"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown      = "$geoip_country_code"
        breakdown_type = "person"
      }
      dateRange = {
        date_from    = "-30d"
        explicitDate = false
      }
      filterTestAccounts = false
      interval           = "day"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        event = "$pageview"
        kind  = "EventsNode"
        math  = "dau"
        name  = "$pageview"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "WorldMap"
        showAlertThresholdLines = false
        showLegend              = false
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

# __generated__ by OpenTofu from "549883/1975723"
resource "posthog_dashboard_layout" "dashboard_1975723" {
  dashboard_id = 1975723
  project_id   = "549883"
  tiles = [
    {
      color      = null
      insight_id = null
      layouts_json = jsonencode({
        sm = {
          h    = 2
          minH = 1
          minW = 3
          w    = 12
          x    = 0
          y    = 0
        }
        xs = {
          h    = 3
          minH = 1
          minW = 1
          w    = 1
          x    = 0
          y    = 0
        }
      })
      show_description = null
      text_body        = "# 👋 Start here\n\nEverything below is captured automatically (pageviews, clicks, sessions, and location), so this dashboard fills in from day one with no extra setup. The headline numbers will feel familiar; the retention and funnel tiles are where you point PostHog at your own events. Edit any tile, or duplicate the dashboard to make it your own."
    },
    {
      color      = "blue"
      insight_id = 10881550
      layouts_json = jsonencode({
        sm = {
          h    = 3
          minH = 3
          minW = 3
          w    = 4
          x    = 0
          y    = 2
        }
        xs = {
          h    = 3
          minH = 3
          minW = 1
          w    = 1
          x    = 0
          y    = 3
        }
      })
      show_description = null
      text_body        = null
    },
    {
      color      = "blue"
      insight_id = 10881551
      layouts_json = jsonencode({
        sm = {
          h    = 3
          minH = 3
          minW = 3
          w    = 4
          x    = 4
          y    = 2
        }
        xs = {
          h    = 3
          minH = 3
          minW = 1
          w    = 1
          x    = 0
          y    = 6
        }
      })
      show_description = null
      text_body        = null
    },
    {
      color      = "blue"
      insight_id = 10881552
      layouts_json = jsonencode({
        sm = {
          h    = 3
          minH = 3
          minW = 3
          w    = 4
          x    = 8
          y    = 2
        }
        xs = {
          h    = 3
          minH = 3
          minW = 1
          w    = 1
          x    = 0
          y    = 9
        }
      })
      show_description = null
      text_body        = null
    },
    {
      color      = null
      insight_id = null
      layouts_json = jsonencode({
        sm = {
          h    = 2
          minH = 1
          minW = 3
          w    = 12
          x    = 0
          y    = 5
        }
        xs = {
          h    = 3
          minH = 1
          minW = 1
          w    = 1
          x    = 0
          y    = 12
        }
      })
      show_description = null
      text_body        = "## Are people coming back?\n\nActive users show your trend; retention shows how many return after their first visit. The clearest sign your product is sticky."
    },
    {
      color      = "blue"
      insight_id = 10881553
      layouts_json = jsonencode({
        sm = {
          h    = 5
          minH = 5
          minW = 3
          w    = 6
          x    = 0
          y    = 7
        }
        xs = {
          h    = 5
          minH = 5
          minW = 1
          w    = 1
          x    = 0
          y    = 15
        }
      })
      show_description = null
      text_body        = null
    },
    {
      color      = "green"
      insight_id = 10881554
      layouts_json = jsonencode({
        sm = {
          h    = 5
          minH = 5
          minW = 3
          w    = 6
          x    = 6
          y    = 7
        }
        xs = {
          h    = 5
          minH = 5
          minW = 1
          w    = 1
          x    = 0
          y    = 20
        }
      })
      show_description = null
      text_body        = null
    },
    {
      color      = "blue"
      insight_id = 10881555
      layouts_json = jsonencode({
        sm = {
          h    = 5
          minH = 5
          minW = 3
          w    = 12
          x    = 0
          y    = 12
        }
        xs = {
          h    = 5
          minH = 5
          minW = 1
          w    = 1
          x    = 0
          y    = 25
        }
      })
      show_description = null
      text_body        = null
    },
    {
      color      = null
      insight_id = null
      layouts_json = jsonencode({
        sm = {
          h    = 2
          minH = 1
          minW = 3
          w    = 12
          x    = 0
          y    = 17
        }
        xs = {
          h    = 3
          minH = 1
          minW = 1
          w    = 1
          x    = 0
          y    = 30
        }
      })
      show_description = null
      text_body        = "## Where your visitors come from\n\nThe sites and channels sending people to your app."
    },
    {
      color      = "purple"
      insight_id = 10881556
      layouts_json = jsonencode({
        sm = {
          h    = 5
          minH = 5
          minW = 3
          w    = 12
          x    = 0
          y    = 19
        }
        xs = {
          h    = 5
          minH = 5
          minW = 1
          w    = 1
          x    = 0
          y    = 33
        }
      })
      show_description = null
      text_body        = null
    },
    {
      color      = null
      insight_id = null
      layouts_json = jsonencode({
        sm = {
          h    = 2
          minH = 1
          minW = 3
          w    = 12
          x    = 0
          y    = 24
        }
        xs = {
          h    = 3
          minH = 1
          minW = 1
          w    = 1
          x    = 0
          y    = 38
        }
      })
      show_description = null
      text_body        = "## Turning visits into actions\n\nA funnel from page view to click. Swap in your own events (signup, purchase, upgrade) to measure real conversion."
    },
    {
      color      = "black"
      insight_id = 10881557
      layouts_json = jsonencode({
        sm = {
          h    = 5
          minH = 5
          minW = 3
          w    = 12
          x    = 0
          y    = 26
        }
        xs = {
          h    = 5
          minH = 5
          minW = 1
          w    = 1
          x    = 0
          y    = 41
        }
      })
      show_description = null
      text_body        = null
    },
    {
      color      = null
      insight_id = null
      layouts_json = jsonencode({
        sm = {
          h    = 2
          minH = 1
          minW = 3
          w    = 12
          x    = 0
          y    = 31
        }
        xs = {
          h    = 3
          minH = 1
          minW = 1
          w    = 1
          x    = 0
          y    = 46
        }
      })
      show_description = null
      text_body        = "## What to do next\n\nYou've got the numbers. Watch how people actually behave, explore raw events, or dig into traffic and acquisition."
    },
  ]
}

# __generated__ by OpenTofu from "549883/11251182"
resource "posthog_insight" "insight_11251182" {
  create_in_folder = null
  dashboard_ids    = [2022116]
  deleted          = false
  derived_name     = null
  description      = "What servers actually consume: prematch/postmatch vs reports, competitions, pairing."
  name             = "Core output mix by kind (weekly)"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown      = "output_kind"
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
        event = "core_output_delivered"
        kind  = "EventsNode"
        name  = "core_output_delivered"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsStackedBar"
        excludeBoxPlotOutliers  = true
        hideWeekends            = false
        legendPosition          = "bottom"
        metricColorByDirection  = false
        metricShowChange        = true
        metricSummary           = "total"
        resultCustomizationBy   = "value"
        showAlertThresholdLines = false
        showAnnotations         = true
        showLegend              = false
        showMultipleYAxes       = false
        showPercentStackView    = false
        showValuesOnSeries      = false
        smoothingIntervals      = 1
        stackBreakdownValues    = false
        yAxisScaleType          = "linear"
        yAxisStartAtZero        = true
      }
    }
  })
  query_sql = null
  tags      = null
}

# __generated__ by OpenTofu from "549883/1977268"
resource "posthog_dashboard_layout" "dashboard_1977268" {
  dashboard_id = 1977268
  project_id   = "549883"
  tiles = [
    {
      color      = null
      insight_id = null
      layouts_json = jsonencode({
        sm = {
          h      = 4
          i      = "257126"
          minH   = 2
          minW   = 3
          moved  = false
          static = false
          w      = 12
          x      = 0
          y      = 0
        }
        xs = {
          h    = 6
          i    = "257126"
          minH = 2
          minW = 1
          w    = 1
          x    = 0
          y    = 50
        }
      })
      show_description = null
      text_body        = "### How to use this dashboard\n\nThis dashboard enables you to analyze trends on your website landing pages. Including:\n\n1. Unique session trends\n2. The most popular landing pages\n3. Referring domains\n4. Pages per session\n5. Average session duration\n6. Where users are from\n7. Device and browser type\n\nTo view data for a specific page, or group of pages, click on 'Add filter' and search for 'Current URL' to filter by URL parameters."
    },
    {
      color      = null
      insight_id = 10892178
      layouts_json = jsonencode({
        sm = {
          h      = 7
          i      = "256443"
          minH   = 5
          minW   = 3
          moved  = false
          static = false
          w      = 12
          x      = 0
          y      = 4
        }
        xs = {
          h    = 5
          i    = "256443"
          minH = 5
          minW = 1
          w    = 1
          x    = 0
          y    = 20
        }
      })
      show_description = null
      text_body        = null
    },
    {
      color      = null
      insight_id = 10892183
      layouts_json = jsonencode({
        sm = {
          h      = 4
          i      = "256417"
          minH   = 4
          minW   = 3
          moved  = false
          static = false
          w      = 6
          x      = 0
          y      = 11
        }
        xs = {
          h    = 5
          i    = "256417"
          minH = 4
          minW = 1
          w    = 1
          x    = 0
          y    = 5
        }
      })
      show_description = null
      text_body        = null
    },
    {
      color      = null
      insight_id = 10892186
      layouts_json = jsonencode({
        sm = {
          h      = 4
          i      = "256484"
          minH   = 4
          minW   = 3
          moved  = false
          static = false
          w      = 6
          x      = 6
          y      = 11
        }
        xs = {
          h    = 5
          i    = "256484"
          minH = 4
          minW = 1
          w    = 1
          x    = 0
          y    = 25
        }
      })
      show_description = null
      text_body        = null
    },
    {
      color      = null
      insight_id = 10892179
      layouts_json = jsonencode({
        sm = {
          h      = 8
          i      = "256402"
          minH   = 5
          minW   = 3
          moved  = false
          static = false
          w      = 6
          x      = 0
          y      = 15
        }
        xs = {
          h    = 5
          i    = "256402"
          minH = 5
          minW = 1
          w    = 1
          x    = 0
          y    = 0
        }
      })
      show_description = null
      text_body        = null
    },
    {
      color      = null
      insight_id = 10892180
      layouts_json = jsonencode({
        sm = {
          h      = 8
          i      = "256415"
          minH   = 5
          minW   = 3
          moved  = false
          static = false
          w      = 6
          x      = 6
          y      = 15
        }
        xs = {
          h    = 5
          i    = "256415"
          minH = 5
          minW = 1
          w    = 1
          x    = 0
          y    = 10
        }
      })
      show_description = null
      text_body        = null
    },
    {
      color      = null
      insight_id = 10892185
      layouts_json = jsonencode({
        sm = {
          h      = 6
          i      = "256485"
          minH   = 5
          minW   = 3
          moved  = false
          static = false
          w      = 6
          x      = 0
          y      = 23
        }
        xs = {
          h    = 5
          i    = "256485"
          minH = 5
          minW = 1
          w    = 1
          x    = 0
          y    = 30
        }
      })
      show_description = null
      text_body        = null
    },
    {
      color      = null
      insight_id = 10892181
      layouts_json = jsonencode({
        sm = {
          h      = 6
          i      = "257111"
          minH   = 5
          minW   = 3
          moved  = false
          static = false
          w      = 6
          x      = 6
          y      = 23
        }
        xs = {
          h    = 5
          i    = "257111"
          minH = 5
          minW = 1
          w    = 1
          x    = 0
          y    = 35
        }
      })
      show_description = null
      text_body        = null
    },
    {
      color      = null
      insight_id = 10892177
      layouts_json = jsonencode({
        sm = {
          h      = 5
          i      = "256430"
          minH   = 5
          minW   = 3
          moved  = false
          static = false
          w      = 4
          x      = 0
          y      = 29
        }
        xs = {
          h    = 5
          i    = "256430"
          minH = 5
          minW = 1
          w    = 1
          x    = 0
          y    = 15
        }
      })
      show_description = null
      text_body        = null
    },
    {
      color      = null
      insight_id = 10892176
      layouts_json = jsonencode({
        sm = {
          h      = 5
          i      = "257119"
          minH   = 5
          minW   = 3
          moved  = false
          static = false
          w      = 4
          x      = 4
          y      = 29
        }
        xs = {
          h    = 5
          i    = "257119"
          minH = 5
          minW = 1
          w    = 1
          x    = 0
          y    = 40
        }
      })
      show_description = null
      text_body        = null
    },
    {
      color      = null
      insight_id = 10892182
      layouts_json = jsonencode({
        sm = {
          h      = 5
          i      = "257118"
          minH   = 5
          minW   = 3
          moved  = false
          static = false
          w      = 4
          x      = 8
          y      = 29
        }
        xs = {
          h    = 5
          i    = "257118"
          minH = 5
          minW = 1
          w    = 1
          x    = 0
          y    = 45
        }
      })
      show_description = null
      text_body        = null
    },
  ]
}

# __generated__ by OpenTofu from "549883/11297204"
resource "posthog_insight" "insight_11297204" {
  create_in_folder = null
  dashboard_ids    = [2027696]
  deleted          = false
  derived_name     = null
  description      = "Deduplicated market lifecycle counts by transition."
  name             = "Bryan Bucks markets opened settled and voided"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown_type = "event"
        breakdowns = [{
          property = "transition"
          type     = "event"
        }]
      }
      dateRange = {
        date_from                = "-90d"
        excludeIncompletePeriods = false
        explicitDate             = false
      }
      filterTestAccounts = false
      interval           = "day"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        event      = "bryan_bucks_lifecycle"
        kind       = "EventsNode"
        math       = "hogql"
        math_hogql = "count(distinct uuid)"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsStackedBar"
        excludeBoxPlotOutliers  = true
        hideWeekends            = false
        legendPosition          = "bottom"
        metricColorByDirection  = false
        metricShowChange        = true
        metricSummary           = "total"
        resultCustomizationBy   = "value"
        showAlertThresholdLines = false
        showAnnotations         = true
        showLegend              = false
        showMultipleYAxes       = false
        showPercentStackView    = false
        showValuesOnSeries      = false
        smoothingIntervals      = 1
        stackBreakdownValues    = false
        yAxisScaleType          = "linear"
        yAxisStartAtZero        = true
      }
    }
  })
  query_sql = null
  tags      = null
}

# __generated__ by OpenTofu from "549883/11297203"
resource "posthog_insight" "insight_11297203" {
  create_in_folder = null
  dashboard_ids    = [2027696]
  deleted          = false
  derived_name     = null
  description      = "Deduplicated daily stake volume from the economy ledger."
  name             = "Bryan Bucks stake volume"
  project_id       = "549883"
  query_json = jsonencode({
    display = "ActionsLineGraph"
    kind    = "DataVisualizationNode"
    source = {
      kind  = "HogQLQuery"
      query = "SELECT day, sum(-delta) AS stake_volume FROM (SELECT uuid, toStartOfDay(timestamp) AS day, argMax(toFloat(properties[delta_bucks]), timestamp) AS delta FROM events WHERE event = bryan_bucks_economy AND properties[movement] IN (bet_stake, parlay_stake) GROUP BY uuid, day) GROUP BY day ORDER BY day"
    }
  })
  query_sql = null
  tags      = null
}

# __generated__ by OpenTofu from "549883/2022116"
resource "posthog_dashboard_layout" "dashboard_2022116" {
  dashboard_id = 2022116
  project_id   = "549883"
  tiles = [
    {
      color            = null
      insight_id       = 11251185
      layouts_json     = null
      show_description = null
      text_body        = null
    },
    {
      color            = null
      insight_id       = 11251184
      layouts_json     = null
      show_description = null
      text_body        = null
    },
    {
      color            = null
      insight_id       = 11251183
      layouts_json     = null
      show_description = null
      text_body        = null
    },
    {
      color            = null
      insight_id       = 11251182
      layouts_json     = null
      show_description = null
      text_body        = null
    },
    {
      color            = null
      insight_id       = 11251174
      layouts_json     = null
      show_description = null
      text_body        = null
    },
    {
      color            = null
      insight_id       = 11251173
      layouts_json     = null
      show_description = null
      text_body        = null
    },
  ]
}

# __generated__ by OpenTofu from "549883/10892236"
resource "posthog_insight" "insight_10892236" {
  create_in_folder = null
  dashboard_ids    = [1977280]
  deleted          = false
  derived_name     = null
  description      = null
  name             = "Top Website Pages (Overall)"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown      = "$current_url"
        breakdown_type = "event"
      }
      dateRange = {
        date_from    = "-30d"
        explicitDate = false
      }
      filterTestAccounts = false
      interval           = "day"
      kind               = "TrendsQuery"
      properties = {
        type = "AND"
        values = [{
          type = "AND"
          values = [{
            key      = "$current_url"
            operator = "not_icontains"
            type     = "event"
            value    = "?"
          }]
        }]
      }
      series = [{
        event = "$pageview"
        kind  = "EventsNode"
        math  = "unique_session"
        name  = "$pageview"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsBarValue"
        showAlertThresholdLines = false
        showLegend              = false
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

# __generated__ by OpenTofu from "549883/10892181"
resource "posthog_insight" "insight_10892181" {
  create_in_folder = null
  dashboard_ids    = [1977268]
  deleted          = false
  derived_name     = null
  description      = "Unique users broken down by new and returning"
  name             = "New & Returning Users"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      dateRange = {
        date_from    = "-30d"
        explicitDate = false
      }
      filterTestAccounts = true
      interval           = "week"
      kind               = "LifecycleQuery"
      lifecycleFilter = {
        showLegend         = false
        showValuesOnSeries = true
        toggledLifecycles  = ["new", "returning"]
      }
      properties = []
      series = [{
        event = "$pageview"
        kind  = "EventsNode"
        name  = "$pageview"
      }]
    }
  })
  query_sql = null
  tags      = null
}

# __generated__ by OpenTofu from "549883/10892223"
resource "posthog_insight" "insight_10892223" {
  create_in_folder = null
  dashboard_ids    = [1977279]
  deleted          = false
  derived_name     = null
  description      = "Shows the number of unique users that use your app every day."
  name             = "Daily active users (DAUs)"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown_type = "event"
      }
      dateRange = {
        date_from    = "-30d"
        explicitDate = false
      }
      filterTestAccounts = false
      interval           = "day"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        event = "$pageview"
        kind  = "EventsNode"
        math  = "dau"
        name  = "$pageview"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsLineGraph"
        showAlertThresholdLines = false
        showLegend              = false
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

# __generated__ by OpenTofu from "549883/10892217"
resource "posthog_insight" "insight_10892217" {
  create_in_folder = null
  dashboard_ids    = [1977278]
  deleted          = false
  derived_name     = null
  description      = "This chart shows which devices your unique users have been using over the past 30 days, so you can ensure you are designing your products and website for the right primary devices. You can get more detailed information by changing the 'Breakdown by' to 'Device ID'."
  name             = "What devices do users access my product with?"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown      = "$device_type"
        breakdown_type = "event"
      }
      compareFilter = {
        compare = false
      }
      dateRange = {
        date_from    = "-30d"
        explicitDate = false
      }
      filterTestAccounts = true
      interval           = "day"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        event = "$pageview"
        kind  = "EventsNode"
        math  = "dau"
        name  = "$pageview"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsBarValue"
        showAlertThresholdLines = false
        showLegend              = false
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

# __generated__ by OpenTofu from "549883/1977268"
resource "posthog_dashboard" "dashboard_1977268" {
  deleted     = false
  description = "Analyze trends on landing pages, including where users come from, browser, and device type."
  name        = "Landing Pages Report"
  pinned      = false
  project_id  = "549883"
  tags        = null
}

# __generated__ by OpenTofu from "549883/1975723"
resource "posthog_dashboard" "dashboard_1975723" {
  deleted     = false
  description = "How people use your app at a glance: traffic, retention, where visitors come from, and whether they take action. Built from automatically captured events, so it works on day one. Swap in your own events to make it yours."
  name        = "Your starter dashboard"
  pinned      = true
  project_id  = "549883"
  tags        = null
}

# __generated__ by OpenTofu from "549883/10892212"
resource "posthog_insight" "insight_10892212" {
  create_in_folder = null
  dashboard_ids    = [1977278]
  deleted          = false
  derived_name     = null
  description      = "This path shows the most 7 common paths taken by users over the last 30 days, starting at their initial pageview and proceeding for 5 steps. The size of a path reflects how common it is, while red areas reflect early drop-off. This can be especially useful for seeing where users get lost and understanding the most popular destinations."
  name             = "How do most users access my product?"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      dateRange = {
        date_from    = "-30d"
        explicitDate = false
      }
      filterTestAccounts = true
      kind               = "PathsQuery"
      pathsFilter = {
        edgeLimit                = 7
        excludeEvents            = []
        includeEventTypes        = ["$pageview"]
        localPathCleaningFilters = []
        pathGroupings            = []
        stepLimit                = 5
      }
      properties = []
    }
  })
  query_sql = null
  tags      = null
}

# __generated__ by OpenTofu
resource "posthog_external_data_source" "pinterest_ads" {
  job_inputs_json = jsonencode({
    ad_account_id                = "549768245877"
    pinterest_ads_integration_id = "209503"
  })
  prefix      = null
  project_id  = "549883"
  schemas     = ["ad_accounts", "ad_analytics", "ad_group_analytics", "ad_groups", "ad_group_targeting_analytics", "ads", "ad_targeting_analytics", "audiences", "campaign_analytics", "campaigns", "campaign_targeting_analytics", "conversion_tags", "keywords"]
  source_type = "PinterestAds"

  lifecycle {
    prevent_destroy = true
  }
}

# __generated__ by OpenTofu from "549883/10892183"
resource "posthog_insight" "insight_10892183" {
  create_in_folder = null
  dashboard_ids    = [1977268]
  deleted          = false
  derived_name     = null
  description      = "The number of unique users who visited a landing page compared to the previous period"
  name             = "Unique Users on Landing Page(s)"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown_type = "event"
      }
      compareFilter = {
        compare = true
      }
      dateRange = {
        date_from    = "-30d"
        explicitDate = false
      }
      filterTestAccounts = true
      interval           = "day"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        event = "$pageview"
        kind  = "EventsNode"
        math  = "dau"
        name  = "$pageview"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "BoldNumber"
        showAlertThresholdLines = false
        showLegend              = false
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

# __generated__ by OpenTofu from "549883/10892232"
resource "posthog_insight" "insight_10892232" {
  create_in_folder = null
  dashboard_ids    = [1977280]
  deleted          = false
  derived_name     = null
  description      = null
  name             = "Website Unique Users (Breakdown)"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown_type = "event"
      }
      dateRange = {
        date_from    = "-30d"
        explicitDate = false
      }
      filterTestAccounts = false
      interval           = "week"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        event = "$pageview"
        kind  = "EventsNode"
        math  = "dau"
        name  = "$pageview"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsBar"
        showAlertThresholdLines = false
        showLegend              = false
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

# __generated__ by OpenTofu from "549883/019fe7f8-ee1c-0000-8f3e-476e8dac0c40"
resource "posthog_hog_function" "geoip" {
  description     = "Adds geoip data to the event"
  enabled         = true
  execution_order = 1
  filters_json = jsonencode({
    source = "events"
  })
  hog                   = "// Define the properties to be added to the event\nlet geoipProperties := {\n    'city_name': null,\n    'city_confidence': null,\n    'subdivision_2_name': null,\n    'subdivision_2_code': null,\n    'subdivision_1_name': null,\n    'subdivision_1_code': null,\n    'country_name': null,\n    'country_code': null,\n    'continent_name': null,\n    'continent_code': null,\n    'postal_code': null,\n    'latitude': null,\n    'longitude': null,\n    'accuracy_radius': null,\n    'time_zone': null\n}\n// Check if the event has an IP address\nif (event.properties?.$geoip_disable or empty(event.properties?.$ip)) {\n    print('geoip disabled or no ip.')\n    return event\n}\nlet ip := event.properties.$ip\n// Check for localhost and common private network IPs\nif (ip == '127.0.0.1' or substring(ip, 1, 8) == '192.168.') {\n    print('spoofing ip for local development', ip)\n    ip := '89.160.20.129'\n}\nlet response := geoipLookup(ip)\nif (not response) {\n    print('geoip lookup failed for ip', ip)\n    return event\n}\nlet location := {}\nif (response.city) {\n    location['city_name'] := response.city.names?.en\n}\nif (response.country) {\n    location['country_name'] := response.country.names?.en\n    location['country_code'] := response.country.isoCode\n}\nif (response.continent) {\n    location['continent_name'] := response.continent.names?.en\n    location['continent_code'] := response.continent.code\n}\nif (response.postal) {\n    location['postal_code'] := response.postal.code\n}\nif (response.location) {\n    location['latitude'] := response.location?.latitude\n    location['longitude'] := response.location?.longitude\n    location['accuracy_radius'] := response.location?.accuracyRadius\n    location['time_zone'] := response.location?.timeZone\n}\nif (response.subdivisions) {\n    for (let index, subdivision in response.subdivisions) {\n        location[f'subdivision_{index + 1}_code'] := subdivision.isoCode\n        location[f'subdivision_{index + 1}_name'] := subdivision.names?.en\n    }\n}\nprint('geoip location data for ip:', location) \nlet returnEvent := event\nreturnEvent.properties := returnEvent.properties ?? {}\nreturnEvent.properties.$set := returnEvent.properties.$set ?? {}\nreturnEvent.properties.$set_once := returnEvent.properties.$set_once ?? {}\nfor (let key, value in geoipProperties) {\n    if (value != null) {\n        returnEvent.properties.$set[f'$geoip_{key}'] := value\n        returnEvent.properties.$set_once[f'$initial_geoip_{key}'] := value\n    }\n    returnEvent.properties.$set[f'$geoip_{key}'] := value\n    returnEvent.properties.$set_once[f'$initial_geoip_{key}'] := value\n}\nfor (let key, value in location) {\n    returnEvent.properties[f'$geoip_{key}'] := value\n    returnEvent.properties.$set[f'$geoip_{key}'] := value\n    returnEvent.properties.$set_once[f'$initial_geoip_{key}'] := value\n}\nreturn returnEvent"
  icon_url              = "/static/transformations/geoip.png"
  inputs_json           = null
  inputs_schema_json    = null
  mappings_json         = null
  masking_json          = null
  name                  = "GeoIP"
  project_id            = "549883"
  sensitive_inputs_json = null # sensitive
  template_id           = "template-geoip"
  type                  = "transformation"
}

# __generated__ by OpenTofu from "549883/11251173"
resource "posthog_insight" "insight_11251173" {
  create_in_folder = null
  dashboard_ids    = [2022116]
  deleted          = false
  derived_name     = null
  description      = "Per installation identity, 14-day conversion window, last 30 days. Activation is decided in minutes — watch step 2."
  name             = "Install funnel: installed → first subscription → first output"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      dateRange = {
        date_from                = "-30d"
        excludeIncompletePeriods = false
        explicitDate             = false
      }
      filterTestAccounts = false
      funnelsFilter = {
        breakdownAttributionType              = "first_touch"
        exclusions                            = []
        funnelOrderType                       = "ordered"
        funnelStepReference                   = "total"
        funnelVizType                         = "steps"
        funnelWindowInterval                  = 14
        funnelWindowIntervalUnit              = "day"
        hideIncompleteConversionWindowPeriods = false
        layout                                = "vertical"
        legendPosition                        = "bottom"
        showAnnotations                       = true
        showLegend                            = false
        showValuesOnSeries                    = false
      }
      kind       = "FunnelsQuery"
      properties = []
      series = [{
        event = "guild_installed"
        kind  = "EventsNode"
        name  = "guild_installed"
        }, {
        event = "first_subscription_created"
        kind  = "EventsNode"
        name  = "first_subscription_created"
        }, {
        event = "first_core_output_delivered"
        kind  = "EventsNode"
        name  = "first_core_output_delivered"
      }]
    }
  })
  query_sql = null
  tags      = null
}

# __generated__ by OpenTofu from "549883/11251184"
resource "posthog_insight" "insight_11251184" {
  create_in_folder = null
  dashboard_ids    = [2022116]
  deleted          = false
  derived_name     = null
  description      = "Was a lost guild ever activated? installed_only churn points at first-5-minutes friction."
  name             = "Removals by activation state"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown      = "activation_state"
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
        event = "guild_removed"
        kind  = "EventsNode"
        name  = "guild_removed"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsStackedBar"
        excludeBoxPlotOutliers  = true
        hideWeekends            = false
        legendPosition          = "bottom"
        metricColorByDirection  = false
        metricShowChange        = true
        metricSummary           = "total"
        resultCustomizationBy   = "value"
        showAlertThresholdLines = false
        showAnnotations         = true
        showLegend              = false
        showMultipleYAxes       = false
        showPercentStackView    = false
        showValuesOnSeries      = false
        smoothingIntervals      = 1
        stackBreakdownValues    = false
        yAxisScaleType          = "linear"
        yAxisStartAtZero        = true
      }
    }
  })
  query_sql = null
  tags      = null
}

# __generated__ by OpenTofu from "549883/10892237"
resource "posthog_insight" "insight_10892237" {
  create_in_folder = null
  dashboard_ids    = [1977280]
  deleted          = false
  derived_name     = null
  description      = null
  name             = "Top Website Pages (via Google)"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown      = "$current_url"
        breakdown_type = "event"
      }
      dateRange = {
        date_from    = "-30d"
        explicitDate = false
      }
      filterTestAccounts = false
      interval           = "day"
      kind               = "TrendsQuery"
      properties = {
        type = "AND"
        values = [{
          type = "AND"
          values = [{
            key      = "$current_url"
            operator = "not_icontains"
            type     = "event"
            value    = "?"
            }, {
            key      = "$referring_domain"
            operator = "icontains"
            type     = "event"
            value    = "google"
          }]
        }]
      }
      series = [{
        event = "$pageview"
        kind  = "EventsNode"
        math  = "unique_session"
        name  = "$pageview"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsBarValue"
        showAlertThresholdLines = false
        showLegend              = false
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

# __generated__ by OpenTofu from "549883/11251183"
resource "posthog_insight" "insight_11251183" {
  create_in_folder = null
  dashboard_ids    = [2022116]
  deleted          = false
  derived_name     = null
  description      = "Net guild growth. Removals carry activation_state and tenure_bucket for drill-down."
  name             = "Installs vs removals (weekly)"
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
      series = [{
        event = "guild_installed"
        kind  = "EventsNode"
        name  = "guild_installed"
        }, {
        event = "guild_removed"
        kind  = "EventsNode"
        name  = "guild_removed"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsBar"
        excludeBoxPlotOutliers  = true
        hideWeekends            = false
        legendPosition          = "bottom"
        metricColorByDirection  = false
        metricShowChange        = true
        metricSummary           = "total"
        resultCustomizationBy   = "value"
        showAlertThresholdLines = false
        showAnnotations         = true
        showLegend              = false
        showMultipleYAxes       = false
        showPercentStackView    = false
        showValuesOnSeries      = false
        smoothingIntervals      = 1
        stackBreakdownValues    = false
        yAxisScaleType          = "linear"
        yAxisStartAtZero        = true
      }
    }
  })
  query_sql = null
  tags      = null
}

# __generated__ by OpenTofu from "549883/469393"
resource "posthog_cohort" "internal_test_users" {
  deleted     = false
  description = "People who are internal team members or test users. Used for filtering out internal traffic from analytics."
  filters = jsonencode({
    properties = {
      type = "OR"
      values = [{
        type = "AND"
        values = [{
          key      = "$internal_or_test_user"
          operator = "exact"
          type     = "person"
          value    = [true]
        }]
        }, {
        type = "AND"
        values = [{
          key      = "email"
          operator = "icontains"
          type     = "person"
          value    = "@sjer.red"
        }]
      }]
    }
  })
  is_static  = false
  name       = "Internal / Test users"
  project_id = "549883"
}

# __generated__ by OpenTofu from "549883/10892225"
resource "posthog_insight" "insight_10892225" {
  create_in_folder = null
  dashboard_ids    = [1977279]
  deleted          = false
  derived_name     = null
  description      = "Weekly retention of your users."
  name             = "Retention"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      dateRange = {
        date_from    = "-7d"
        explicitDate = false
      }
      filterTestAccounts = false
      kind               = "RetentionQuery"
      properties         = []
      retentionFilter = {
        period        = "Week"
        retentionType = "retention_first_time"
        returningEntity = {
          id   = "$pageview"
          name = "$pageview"
          type = "events"
        }
        targetEntity = {
          id   = "$pageview"
          name = "$pageview"
          type = "events"
        }
        totalIntervals = 11
      }
    }
  })
  query_sql = null
  tags      = null
}

# __generated__ by OpenTofu from "549883/2027696"
resource "posthog_dashboard" "dashboard_2027696" {
  deleted     = false
  description = "Beta-only Bryan Bucks engagement, market lifecycle, economy, retention, and data freshness. Member retention uses opaque app-owned account identities; house accounts are excluded."
  name        = "Bryan Bucks Beta Activity"
  pinned      = false
  project_id  = "549883"
  tags        = ["activity", "beta", "bryan-bucks"]
}

# __generated__ by OpenTofu from "549883/10892179"
resource "posthog_insight" "insight_10892179" {
  create_in_folder = null
  dashboard_ids    = [1977268]
  deleted          = false
  derived_name     = null
  description      = "Breakdown of most popular landing pages by unique sessions"
  name             = "Most Popular Landing Pages"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown               = "$current_url"
        breakdown_normalize_url = true
        breakdown_type          = "event"
      }
      compareFilter = {
        compare = false
      }
      dateRange = {
        date_from    = "-30d"
        explicitDate = false
      }
      filterTestAccounts = true
      interval           = "day"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        event = "$pageview"
        kind  = "EventsNode"
        math  = "unique_session"
        name  = "$pageview"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsTable"
        showAlertThresholdLines = false
        showLegend              = false
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

# __generated__ by OpenTofu from "549883/11297196"
resource "posthog_insight" "insight_11297196" {
  create_in_folder = null
  dashboard_ids    = [2027696]
  deleted          = false
  derived_name     = null
  description      = "Weekly unique non-house Bucks members with activity."
  name             = "Bryan Bucks weekly active members"
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
      series = [{
        event = "bryan_bucks_member_activity"
        kind  = "EventsNode"
        math  = "weekly_active"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsLineGraph"
        excludeBoxPlotOutliers  = true
        hideWeekends            = false
        legendPosition          = "bottom"
        metricColorByDirection  = false
        metricShowChange        = true
        metricSummary           = "total"
        resultCustomizationBy   = "value"
        showAlertThresholdLines = false
        showAnnotations         = true
        showLegend              = false
        showMultipleYAxes       = false
        showPercentStackView    = false
        showValuesOnSeries      = false
        smoothingIntervals      = 1
        stackBreakdownValues    = false
        yAxisScaleType          = "linear"
        yAxisStartAtZero        = true
      }
    }
  })
  query_sql = null
  tags      = null
}

# __generated__ by OpenTofu from "549883/2022116"
resource "posthog_dashboard" "dashboard_2022116" {
  deleted     = false
  description = "Install funnel, active guilds, output mix, churn, and channel attribution for Scout for LoL. Created 2026-08-22; attribution + Explore + command tiles extend it once PRs #2337/#2338 deploy."
  name        = "Scout Growth & Retention"
  pinned      = true
  project_id  = "549883"
  tags        = null
}

# __generated__ by OpenTofu from "549883/10892216"
resource "posthog_insight" "insight_10892216" {
  create_in_folder = null
  dashboard_ids    = [1977278]
  deleted          = false
  derived_name     = null
  description      = "This chart shows on which pages users have rageclicked the most in the last 30 days. This can be helpful for finding areas of your product where users experience significant frustration."
  name             = "Where are my users experiencing frustration?"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown      = "$current_url"
        breakdown_type = "event"
      }
      dateRange = {
        date_from    = "-30d"
        explicitDate = false
      }
      filterTestAccounts = true
      interval           = "day"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        event = "$rageclick"
        kind  = "EventsNode"
        math  = "dau"
        name  = "$rageclick"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsBarValue"
        showAlertThresholdLines = false
        showLegend              = false
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

# __generated__ by OpenTofu from "549883/10881553"
resource "posthog_insight" "insight_10881553" {
  create_in_folder = null
  dashboard_ids    = [1975723]
  deleted          = false
  derived_name     = null
  description      = "Unique people who use your app each day. Watch for steady growth or sudden drops."
  name             = "Daily active users (DAUs)"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown_type = "event"
      }
      dateRange = {
        date_from    = "-30d"
        explicitDate = false
      }
      filterTestAccounts = false
      interval           = "day"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        kind = "GroupNode"
        math = "dau"
        name = "Pageview or screen"
        nodes = [{
          event = "$pageview"
          kind  = "EventsNode"
          name  = "$pageview"
          }, {
          event = "$screen"
          kind  = "EventsNode"
          name  = "$screen"
        }]
        operator = "OR"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsLineGraph"
        showAlertThresholdLines = false
        showLegend              = false
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

# __generated__ by OpenTofu from "549883/10892224"
resource "posthog_insight" "insight_10892224" {
  create_in_folder = null
  dashboard_ids    = [1977279]
  deleted          = false
  derived_name     = null
  description      = "Shows the number of unique users that use your app every week."
  name             = "Weekly active users (WAUs)"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown_type = "event"
      }
      dateRange = {
        date_from    = "-90d"
        explicitDate = false
      }
      filterTestAccounts = false
      interval           = "week"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        event = "$pageview"
        kind  = "EventsNode"
        math  = "weekly_active"
        name  = "$pageview"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsLineGraph"
        showAlertThresholdLines = false
        showLegend              = false
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

# __generated__ by OpenTofu from "549883/10892178"
resource "posthog_insight" "insight_10892178" {
  create_in_folder = null
  dashboard_ids    = [1977268]
  deleted          = false
  derived_name     = null
  description      = "Unique sessions on landing page(s)"
  name             = "Unique Sessions Trend"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown_type = "event"
      }
      dateRange = {
        date_from    = "-30d"
        explicitDate = false
      }
      filterTestAccounts = true
      interval           = "day"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        custom_name = "Unique Sessions"
        event       = "$pageview"
        kind        = "EventsNode"
        math        = "unique_session"
        name        = "$pageview"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsAreaGraph"
        showAlertThresholdLines = false
        showLegend              = false
        showPercentStackView    = false
        showValuesOnSeries      = true
        smoothingIntervals      = 1
        yAxisScaleType          = "linear"
      }
    }
  })
  query_sql = null
  tags      = null
}

# __generated__ by OpenTofu from "549883/10892177"
resource "posthog_insight" "insight_10892177" {
  create_in_folder = null
  dashboard_ids    = [1977268]
  deleted          = false
  derived_name     = null
  description      = "Users broken down by country"
  name             = "Which country are users from?"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown      = "$geoip_country_name"
        breakdown_type = "event"
      }
      dateRange = {
        date_from    = "-30d"
        explicitDate = false
      }
      filterTestAccounts = true
      interval           = "day"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        custom_name = "Country"
        event       = "$pageview"
        kind        = "EventsNode"
        math        = "dau"
        name        = "$pageview"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsBarValue"
        showAlertThresholdLines = false
        showLegend              = false
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

# __generated__ by OpenTofu from "549883/10892231"
resource "posthog_insight" "insight_10892231" {
  create_in_folder = null
  dashboard_ids    = [1977280]
  deleted          = false
  derived_name     = null
  description      = null
  name             = "Organic SEO Unique Users (Total)"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown_type = "event"
      }
      compareFilter = {
        compare = true
      }
      dateRange = {
        date_from    = "-30d"
        explicitDate = false
      }
      filterTestAccounts = false
      interval           = "day"
      kind               = "TrendsQuery"
      properties = {
        type = "AND"
        values = [{
          type = "AND"
          values = [{
            key      = "$referring_domain"
            operator = "icontains"
            type     = "event"
            value    = "google"
            }, {
            key      = "utm_source"
            operator = "is_not_set"
            type     = "event"
            value    = "is_not_set"
          }]
        }]
      }
      series = [{
        event = "$pageview"
        kind  = "EventsNode"
        math  = "dau"
        name  = "$pageview"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "BoldNumber"
        showAlertThresholdLines = false
        showLegend              = false
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

# __generated__ by OpenTofu from "549883/1977279"
resource "posthog_dashboard" "dashboard_1977279" {
  deleted     = false
  description = "High-level overview of your product including daily active users, weekly active users, retention, and growth accounting."
  name        = "Product Analytics"
  pinned      = false
  project_id  = "549883"
  tags        = null
}

# __generated__ by OpenTofu from "549883/10892234"
resource "posthog_insight" "insight_10892234" {
  create_in_folder = null
  dashboard_ids    = [1977280]
  deleted          = false
  derived_name     = null
  description      = null
  name             = "Sessions Per User"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown_type = "event"
      }
      dateRange = {
        date_from    = "-30d"
        explicitDate = false
      }
      filterTestAccounts = false
      interval           = "week"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        event = "$pageview"
        kind  = "EventsNode"
        math  = "dau"
        name  = "$pageview"
        }, {
        event = "$pageview"
        kind  = "EventsNode"
        math  = "unique_session"
        name  = "$pageview"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsLineGraph"
        formula                 = "B/A"
        showAlertThresholdLines = false
        showLegend              = false
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

# __generated__ by OpenTofu from "549883/10892180"
resource "posthog_insight" "insight_10892180" {
  create_in_folder = null
  dashboard_ids    = [1977268]
  deleted          = false
  derived_name     = null
  description      = "How users arrived on your landing pages broken down by referring domain"
  name             = "Referring Domains"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown      = "$referring_domain"
        breakdown_type = "event"
      }
      dateRange = {
        date_from    = "-30d"
        explicitDate = false
      }
      filterTestAccounts = true
      interval           = "day"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        event = "$pageview"
        kind  = "EventsNode"
        math  = "unique_session"
        name  = "$pageview"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsTable"
        showAlertThresholdLines = false
        showLegend              = false
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

# __generated__ by OpenTofu from "549883/1977278"
resource "posthog_dashboard_layout" "dashboard_1977278" {
  dashboard_id = 1977278
  project_id   = "549883"
  tiles = [
    {
      color            = null
      insight_id       = 10892220
      layouts_json     = null
      show_description = null
      text_body        = null
    },
    {
      color            = null
      insight_id       = 10892219
      layouts_json     = null
      show_description = null
      text_body        = null
    },
    {
      color            = null
      insight_id       = 10892218
      layouts_json     = null
      show_description = null
      text_body        = null
    },
    {
      color            = null
      insight_id       = 10892217
      layouts_json     = null
      show_description = null
      text_body        = null
    },
    {
      color            = null
      insight_id       = 10892216
      layouts_json     = null
      show_description = null
      text_body        = null
    },
    {
      color            = null
      insight_id       = 10892215
      layouts_json     = null
      show_description = null
      text_body        = null
    },
    {
      color            = null
      insight_id       = 10892214
      layouts_json     = null
      show_description = null
      text_body        = null
    },
    {
      color            = null
      insight_id       = 10892213
      layouts_json     = null
      show_description = null
      text_body        = null
    },
    {
      color            = null
      insight_id       = 10892212
      layouts_json     = null
      show_description = null
      text_body        = null
    },
  ]
}

# __generated__ by OpenTofu from "549883/11297206"
resource "posthog_insight" "insight_11297206" {
  create_in_folder = null
  dashboard_ids    = [2027696]
  deleted          = false
  derived_name     = null
  description      = "Deduplicated daily earnings and payouts from the economy ledger."
  name             = "Bryan Bucks earnings and payouts"
  project_id       = "549883"
  query_json = jsonencode({
    display = "ActionsLineGraph"
    kind    = "DataVisualizationNode"
    source = {
      kind  = "HogQLQuery"
      query = "SELECT day, sumIf(delta, movement IN (earn_game, earn_win, earn_mvp, earn_ranked_5s_bonus)) AS earnings, sumIf(delta, movement IN (bet_payout, parlay_payout)) AS payouts FROM (SELECT uuid, toStartOfDay(timestamp) AS day, properties[movement] AS movement, argMax(toFloat(properties[delta_bucks]), timestamp) AS delta FROM events WHERE event = bryan_bucks_economy GROUP BY uuid, day, movement) GROUP BY day ORDER BY day"
    }
  })
  query_sql = null
  tags      = null
}

# __generated__ by OpenTofu from "549883/10892220"
resource "posthog_insight" "insight_10892220" {
  create_in_folder = null
  dashboard_ids    = [1977278]
  deleted          = false
  derived_name     = null
  description      = "This chart shows where all pageviews for unique users originated from over the last 30 days."
  name             = "Where are my users located?"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown      = "$geoip_country_code"
        breakdown_type = "person"
      }
      dateRange = {
        date_from    = "-30d"
        explicitDate = false
      }
      filterTestAccounts = true
      interval           = "day"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        event = "$pageview"
        kind  = "EventsNode"
        math  = "dau"
        name  = "$pageview"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "WorldMap"
        showAlertThresholdLines = false
        showLegend              = false
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

# __generated__ by OpenTofu from "549883/10892185"
resource "posthog_insight" "insight_10892185" {
  create_in_folder = null
  dashboard_ids    = [1977268]
  deleted          = false
  derived_name     = null
  description      = "How many pages users visit in each unique session."
  name             = "Pages Per Session"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown_type = "event"
      }
      compareFilter = {
        compare = false
      }
      dateRange = {
        date_from    = "-30d"
        explicitDate = false
      }
      filterTestAccounts = true
      interval           = "day"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        event = "$pageview"
        kind  = "EventsNode"
        math  = "total"
        name  = "$pageview"
        }, {
        event = "$pageview"
        kind  = "EventsNode"
        math  = "unique_session"
        name  = "$pageview"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsAreaGraph"
        formula                 = "A/B"
        showAlertThresholdLines = false
        showLegend              = false
        showPercentStackView    = false
        showValuesOnSeries      = true
        smoothingIntervals      = 1
        yAxisScaleType          = "linear"
      }
    }
  })
  query_sql = null
  tags      = null
}

# __generated__ by OpenTofu from "549883/1977279"
resource "posthog_dashboard_layout" "dashboard_1977279" {
  dashboard_id = 1977279
  project_id   = "549883"
  tiles = [
    {
      color      = "blue"
      insight_id = 10892223
      layouts_json = jsonencode({
        sm = {
          h    = 5
          minH = 5
          minW = 3
          w    = 6
          x    = 0
          y    = 0
        }
        xs = {
          h    = 5
          minH = 5
          minW = 3
          w    = 1
          x    = 0
          y    = 0
        }
      })
      show_description = null
      text_body        = null
    },
    {
      color      = "green"
      insight_id = 10892224
      layouts_json = jsonencode({
        sm = {
          h    = 5
          minH = 5
          minW = 3
          w    = 6
          x    = 6
          y    = 0
        }
        xs = {
          h    = 5
          minH = 5
          minW = 3
          w    = 1
          x    = 0
          y    = 5
        }
      })
      show_description = null
      text_body        = null
    },
    {
      color      = "purple"
      insight_id = 10892226
      layouts_json = jsonencode({
        sm = {
          h    = 5
          minH = 5
          minW = 3
          w    = 6
          x    = 0
          y    = 5
        }
        xs = {
          h    = 5
          minH = 5
          minW = 3
          w    = 1
          x    = 0
          y    = 15
        }
      })
      show_description = null
      text_body        = null
    },
    {
      color      = "blue"
      insight_id = 10892225
      layouts_json = jsonencode({
        sm = {
          h    = 5
          minH = 5
          minW = 3
          w    = 6
          x    = 6
          y    = 5
        }
        xs = {
          h    = 5
          minH = 5
          minW = 3
          w    = 1
          x    = 0
          y    = 10
        }
      })
      show_description = null
      text_body        = null
    },
    {
      color      = "black"
      insight_id = 10892227
      layouts_json = jsonencode({
        sm = {
          h    = 5
          minH = 5
          minW = 3
          w    = 6
          x    = 0
          y    = 10
        }
        xs = {
          h    = 5
          minH = 5
          minW = 3
          w    = 1
          x    = 0
          y    = 20
        }
      })
      show_description = null
      text_body        = null
    },
    {
      color      = "green"
      insight_id = 10892228
      layouts_json = jsonencode({
        sm = {
          h    = 5
          minH = 5
          minW = 3
          w    = 6
          x    = 6
          y    = 10
        }
        xs = {
          h    = 5
          minH = 5
          minW = 3
          w    = 1
          x    = 0
          y    = 25
        }
      })
      show_description = null
      text_body        = null
    },
  ]
}

# __generated__ by OpenTofu from "549883/10892182"
resource "posthog_insight" "insight_10892182" {
  create_in_folder = null
  dashboard_ids    = [1977268]
  deleted          = false
  derived_name     = null
  description      = null
  name             = "Unique Users by Device Type"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown      = "$device_type"
        breakdown_type = "event"
      }
      dateRange = {
        date_from    = "-30d"
        explicitDate = false
      }
      filterTestAccounts = true
      interval           = "day"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        event = "$pageview"
        kind  = "EventsNode"
        math  = "dau"
        name  = "$pageview"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsPie"
        showAlertThresholdLines = false
        showLegend              = false
        showPercentStackView    = false
        showValuesOnSeries      = true
        smoothingIntervals      = 1
        yAxisScaleType          = "linear"
      }
    }
  })
  query_sql = null
  tags      = null
}

# __generated__ by OpenTofu from "549883/2027696"
resource "posthog_dashboard_layout" "dashboard_2027696" {
  dashboard_id = 2027696
  project_id   = "549883"
  tiles = [
    {
      color            = null
      insight_id       = 11297213
      layouts_json     = null
      show_description = null
      text_body        = null
    },
    {
      color            = null
      insight_id       = 11297212
      layouts_json     = null
      show_description = null
      text_body        = null
    },
    {
      color            = null
      insight_id       = 11297206
      layouts_json     = null
      show_description = null
      text_body        = null
    },
    {
      color            = null
      insight_id       = 11297204
      layouts_json     = null
      show_description = null
      text_body        = null
    },
    {
      color            = null
      insight_id       = 11297203
      layouts_json     = null
      show_description = null
      text_body        = null
    },
    {
      color            = null
      insight_id       = 11297201
      layouts_json     = null
      show_description = null
      text_body        = null
    },
    {
      color            = null
      insight_id       = 11297198
      layouts_json     = null
      show_description = null
      text_body        = null
    },
    {
      color            = null
      insight_id       = 11297197
      layouts_json     = null
      show_description = null
      text_body        = null
    },
    {
      color            = null
      insight_id       = 11297196
      layouts_json     = null
      show_description = null
      text_body        = null
    },
    {
      color            = null
      insight_id       = 11297195
      layouts_json     = null
      show_description = null
      text_body        = null
    },
  ]
}

# __generated__ by OpenTofu from "549883/10892218"
resource "posthog_insight" "insight_10892218" {
  create_in_folder = null
  dashboard_ids    = [1977278]
  deleted          = false
  derived_name     = null
  description      = "This chart shows the referring domain for all pageviews by unique users in the last 30 days. This can be especially helpful for understanding how users find your product."
  name             = "How do users find my product?"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown      = "$referring_domain"
        breakdown_type = "event"
      }
      dateRange = {
        date_from    = "-30d"
        explicitDate = false
      }
      filterTestAccounts = true
      interval           = "day"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        event = "$pageview"
        kind  = "EventsNode"
        math  = "dau"
        name  = "$pageview"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsBarValue"
        showAlertThresholdLines = false
        showLegend              = false
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

# __generated__ by OpenTofu from "549883/10881552"
resource "posthog_insight" "insight_10881552" {
  create_in_folder = null
  dashboard_ids    = [1975723]
  deleted          = false
  derived_name     = null
  description      = "Total pages viewed in the last 7 days, repeat views included. The classic traffic-volume number."
  name             = "Pageviews (last 7 days)"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown_type = "event"
      }
      dateRange = {
        date_from    = "-7d"
        explicitDate = false
      }
      filterTestAccounts = false
      interval           = "day"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        event = "$pageview"
        kind  = "EventsNode"
        math  = "total"
        name  = "$pageview"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "BoldNumber"
        showAlertThresholdLines = false
        showLegend              = false
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

# __generated__ by OpenTofu from "549883/10881556"
resource "posthog_insight" "insight_10881556" {
  create_in_folder = null
  dashboard_ids    = [1975723]
  deleted          = false
  derived_name     = null
  description      = "Which sites send you the most visitors, like search, social, and direct. Your acquisition channels at a glance."
  name             = "Top referrers"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown      = "$referring_domain"
        breakdown_type = "event"
      }
      dateRange = {
        date_from    = "-7d"
        explicitDate = false
      }
      filterTestAccounts = false
      interval           = "day"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        event = "$pageview"
        kind  = "EventsNode"
        math  = "dau"
        name  = "$pageview"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsBarValue"
        showAlertThresholdLines = false
        showLegend              = false
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

# __generated__ by OpenTofu from "549883/10892213"
resource "posthog_insight" "insight_10892213" {
  create_in_folder = null
  dashboard_ids    = [1977278]
  deleted          = false
  derived_name     = null
  description      = "This chart shows what the most popular screen height is for unique users over the past 30 days. You can correlate this with screen width by changing the 'Breakdown by' option to specify 'Screen Width'."
  name             = "What screen size do users have?"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown      = "$screen_height"
        breakdown_type = "event"
      }
      dateRange = {
        date_from    = "-30d"
        explicitDate = false
      }
      filterTestAccounts = true
      interval           = "day"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        event = "$pageview"
        kind  = "EventsNode"
        math  = "dau"
        name  = "$pageview"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsBarValue"
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

# __generated__ by OpenTofu from "549883/10892215"
resource "posthog_insight" "insight_10892215" {
  create_in_folder = null
  dashboard_ids    = [1977278]
  deleted          = false
  derived_name     = null
  description      = "The GREEN section of this lifecycle chart shows identified users who completed a pageview in the last 30 days and in the previous 30 days, indicated strong engagement. By clicking through on each bar you can see a full list of the identified users, which is useful for arranging customer interviews or examining their sessions."
  name             = "Which users are highly engaged?"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      dateRange = {
        date_from    = "-30d"
        explicitDate = false
      }
      filterTestAccounts = true
      interval           = "week"
      kind               = "LifecycleQuery"
      lifecycleFilter = {
        showLegend = false
      }
      properties = []
      series = [{
        event = "$pageview"
        kind  = "EventsNode"
        name  = "$pageview"
        properties = [{
          key      = "email"
          operator = "is_set"
          type     = "person"
          value    = "is_set"
        }]
      }]
    }
  })
  query_sql = null
  tags      = null
}

# __generated__ by OpenTofu from "549883/10881551"
resource "posthog_insight" "insight_10881551" {
  create_in_folder = null
  dashboard_ids    = [1975723]
  deleted          = false
  derived_name     = null
  description      = "Distinct visits in the last 7 days. A session groups everything one person does in a single sitting."
  name             = "Sessions (last 7 days)"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown_type = "event"
      }
      dateRange = {
        date_from    = "-7d"
        explicitDate = false
      }
      filterTestAccounts = false
      interval           = "day"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        event = "$pageview"
        kind  = "EventsNode"
        math  = "unique_session"
        name  = "$pageview"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "BoldNumber"
        showAlertThresholdLines = false
        showLegend              = false
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

# __generated__ by OpenTofu from "549883/10892214"
resource "posthog_insight" "insight_10892214" {
  create_in_folder = null
  dashboard_ids    = [1977278]
  deleted          = false
  derived_name     = null
  description      = "This chart looks at the most popular languages among users over the last 30 days, identified by the language they've chosen for their browser. This can help you identify if you need to consider translating your product, or marketing to specific geographies."
  name             = "What languages do users prefer?"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown      = "$browser_language"
        breakdown_type = "event"
      }
      compareFilter = {
        compare = false
      }
      dateRange = {
        date_from    = "-7d"
        explicitDate = false
      }
      filterTestAccounts = true
      interval           = "day"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        event = "$pageview"
        kind  = "EventsNode"
        math  = "dau"
        name  = "$pageview"
      }]
      trendsFilter = {
        aggregationAxisFormat = "numeric"
        display               = "ActionsBarValue"
        resultCustomizationBy = "position"
        resultCustomizations = {
          "1" = {
            assignmentBy = "position"
            hidden       = true
          }
        }
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

# __generated__ by OpenTofu from "549883/11297198"
resource "posthog_insight" "insight_11297198" {
  create_in_folder = null
  dashboard_ids    = [2027696]
  deleted          = false
  derived_name     = null
  description      = "Weekly retention after a member first uses Bryan Bucks."
  name             = "Bryan Bucks first-use retention cohorts"
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
      kind               = "RetentionQuery"
      properties         = []
      retentionFilter = {
        aggregationPropertyType = "event"
        aggregationType         = "count"
        cohortLabelStartIndex   = 0
        cumulative              = false
        period                  = "Week"
        retentionReference      = "total"
        retentionType           = "retention_first_time"
        returningEntity = {
          id   = "bryan_bucks_member_activity"
          name = "Bryan Bucks activity"
          type = "events"
        }
        targetEntity = {
          id   = "bryan_bucks_member_activity"
          name = "Bryan Bucks activity"
          type = "events"
        }
        totalIntervals = 8
      }
    }
  })
  query_sql = null
  tags      = null
}

# __generated__ by OpenTofu from "549883/1977278"
resource "posthog_dashboard" "dashboard_1977278" {
  deleted     = false
  description = "Understand who your users are, how they interact with your product and what browsers or devices they use. Additionally, you can use the 'Which users are highly engaged?' insight to find identified power users, so you can approach them for customer interviews or view their session recordings."
  name        = "User Research"
  pinned      = false
  project_id  = "549883"
  tags        = null
}

# __generated__ by OpenTofu from "549883/10892186"
resource "posthog_insight" "insight_10892186" {
  create_in_folder = null
  dashboard_ids    = [1977268]
  deleted          = false
  derived_name     = null
  description      = null
  name             = "Average Session Duration"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown_type = "event"
      }
      compareFilter = {
        compare = true
      }
      dateRange = {
        date_from    = "-30d"
        explicitDate = false
      }
      filterTestAccounts = true
      interval           = "day"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        event         = "$pageview"
        kind          = "EventsNode"
        math          = "avg"
        math_property = "$session_duration"
        name          = "$pageview"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "duration"
        display                 = "BoldNumber"
        showAlertThresholdLines = false
        showLegend              = false
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

# __generated__ by OpenTofu from "549883/10892230"
resource "posthog_insight" "insight_10892230" {
  create_in_folder = null
  dashboard_ids    = [1977280]
  deleted          = false
  derived_name     = null
  description      = "Shows the number of unique users over the last 30 days."
  name             = "Website Unique Users (Total)"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown_type = "event"
      }
      compareFilter = {
        compare = true
      }
      dateRange = {
        date_from    = "-30d"
        explicitDate = false
      }
      filterTestAccounts = false
      interval           = "day"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        event = "$pageview"
        kind  = "EventsNode"
        math  = "dau"
        name  = "$pageview"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "BoldNumber"
        showAlertThresholdLines = false
        showLegend              = false
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

# __generated__ by OpenTofu from "549883/11297197"
resource "posthog_insight" "insight_11297197" {
  create_in_folder = null
  dashboard_ids    = [2027696]
  deleted          = false
  derived_name     = null
  description      = "First-use members compared with daily active members."
  name             = "Bryan Bucks new versus returning members"
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
      interval           = "day"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        event = "bryan_bucks_member_activity"
        kind  = "EventsNode"
        math  = "dau"
        }, {
        event = "bryan_bucks_member_activity"
        kind  = "EventsNode"
        math  = "first_time_for_user"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsLineGraph"
        excludeBoxPlotOutliers  = true
        hideWeekends            = false
        legendPosition          = "bottom"
        metricColorByDirection  = false
        metricShowChange        = true
        metricSummary           = "total"
        resultCustomizationBy   = "value"
        showAlertThresholdLines = false
        showAnnotations         = true
        showLegend              = false
        showMultipleYAxes       = false
        showPercentStackView    = false
        showValuesOnSeries      = false
        smoothingIntervals      = 1
        stackBreakdownValues    = false
        yAxisScaleType          = "linear"
        yAxisStartAtZero        = true
      }
    }
  })
  query_sql = null
  tags      = null
}

# __generated__ by OpenTofu from "549883"
resource "posthog_project_settings" "monorepo" {
  app_urls                                         = local.app_urls
  autocapture_exceptions_opt_in                    = null
  autocapture_web_vitals_opt_in                    = true
  capture_performance_opt_in                       = true
  cookieless_server_hash_mode                      = 0
  heatmaps_opt_in                                  = true
  project_id                                       = "549883"
  recording_domains                                = local.recording_domains
  session_recording_network_payload_capture_config = null
  session_recording_opt_in                         = true
  surveys_opt_in                                   = null
  test_account_filters = jsonencode([{
    key      = "id"
    operator = "not_in"
    type     = "cohort"
    value    = posthog_cohort.internal_test_users.id
  }])
  test_account_filters_default_checked = null
}

# __generated__ by OpenTofu from "019fe7f8-ecce-0000-adca-fe93618022c7/019fe7f8-ecd5-0000-33c2-62f36e0cec32"
resource "posthog_organization_member" "owner" {
  level             = "owner"
  organization_id   = "019fe7f8-ecce-0000-adca-fe93618022c7"
  retain_on_destroy = true
  user_uuid         = "019fe7f8-ecd5-0000-33c2-62f36e0cec32"

  lifecycle {
    prevent_destroy = true
  }
}

# __generated__ by OpenTofu from "549883/10892176"
resource "posthog_insight" "insight_10892176" {
  create_in_folder = null
  dashboard_ids    = [1977268]
  deleted          = false
  derived_name     = null
  description      = null
  name             = "Unique Users by Browser"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown      = "$browser"
        breakdown_type = "event"
      }
      dateRange = {
        date_from    = "-30d"
        explicitDate = false
      }
      filterTestAccounts = true
      interval           = "day"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        event = "$pageview"
        kind  = "EventsNode"
        math  = "dau"
        name  = "$pageview"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsPie"
        showAlertThresholdLines = false
        showLegend              = false
        showPercentStackView    = false
        showValuesOnSeries      = true
        smoothingIntervals      = 1
        yAxisScaleType          = "linear"
      }
    }
  })
  query_sql = null
  tags      = null
}

# __generated__ by OpenTofu from "549883/10892228"
resource "posthog_insight" "insight_10892228" {
  create_in_folder = null
  dashboard_ids    = [1977279]
  deleted          = false
  derived_name     = null
  description      = "This example funnel shows how many of your users have completed 3 page views, broken down by browser."
  name             = "Pageview funnel, by browser"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown      = "$browser"
        breakdown_type = "event"
      }
      dateRange = {
        date_from    = "-7d"
        explicitDate = false
      }
      filterTestAccounts = false
      funnelsFilter = {
        breakdownAttributionType = "first_touch"
        exclusions               = []
        funnelOrderType          = "ordered"
        funnelStepReference      = "total"
        funnelVizType            = "steps"
        funnelWindowInterval     = 14
        funnelWindowIntervalUnit = "day"
        layout                   = "horizontal"
      }
      interval   = "day"
      kind       = "FunnelsQuery"
      properties = []
      series = [{
        custom_name = "First page view"
        event       = "$pageview"
        kind        = "EventsNode"
        name        = "$pageview"
        }, {
        custom_name = "Second page view"
        event       = "$pageview"
        kind        = "EventsNode"
        name        = "$pageview"
        }, {
        custom_name = "Third page view"
        event       = "$pageview"
        kind        = "EventsNode"
        name        = "$pageview"
      }]
    }
  })
  query_sql = null
  tags      = null
}

# __generated__ by OpenTofu from "549883/11297212"
resource "posthog_insight" "insight_11297212" {
  create_in_folder = null
  dashboard_ids    = [2027696]
  deleted          = false
  derived_name     = null
  description      = "Daily maximum observed member balance, house balance, and pending liability."
  name             = "Bryan Bucks economy balances and pending liability"
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
      interval           = "day"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        event         = "bryan_bucks_economy_snapshot"
        kind          = "EventsNode"
        math          = "max"
        math_property = "total_member_balance_bucks"
        name          = "Member balance"
        }, {
        event         = "bryan_bucks_economy_snapshot"
        kind          = "EventsNode"
        math          = "max"
        math_property = "pending_stake_bucks"
        name          = "Pending liability"
        }, {
        event         = "bryan_bucks_economy_snapshot"
        kind          = "EventsNode"
        math          = "max"
        math_property = "house_balance_bucks"
        name          = "House balance"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsLineGraph"
        excludeBoxPlotOutliers  = true
        hideWeekends            = false
        legendPosition          = "bottom"
        metricColorByDirection  = false
        metricShowChange        = true
        metricSummary           = "total"
        resultCustomizationBy   = "value"
        showAlertThresholdLines = false
        showAnnotations         = true
        showLegend              = false
        showMultipleYAxes       = false
        showPercentStackView    = false
        showValuesOnSeries      = false
        smoothingIntervals      = 1
        stackBreakdownValues    = false
        yAxisScaleType          = "linear"
        yAxisStartAtZero        = true
      }
    }
  })
  query_sql = null
  tags      = null
}

# __generated__ by OpenTofu from "549883/11251185"
resource "posthog_insight" "insight_11251185" {
  create_in_folder = null
  dashboard_ids    = [2022116]
  deleted          = false
  derived_name     = null
  description      = "Interim channel attribution until guild_install_attributed / bot_install_completed land (PR #2338): CTA clicks broken down by the person's first-touch utm_source."
  name             = "Get Started clicks by first-touch source"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown      = "$initial_utm_source"
        breakdown_type = "person"
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
        event = "get_started_click"
        kind  = "EventsNode"
        name  = "get_started_click"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsStackedBar"
        excludeBoxPlotOutliers  = true
        hideWeekends            = false
        legendPosition          = "bottom"
        metricColorByDirection  = false
        metricShowChange        = true
        metricSummary           = "total"
        resultCustomizationBy   = "value"
        showAlertThresholdLines = false
        showAnnotations         = true
        showLegend              = false
        showMultipleYAxes       = false
        showPercentStackView    = false
        showValuesOnSeries      = false
        smoothingIntervals      = 1
        stackBreakdownValues    = false
        yAxisScaleType          = "linear"
        yAxisStartAtZero        = true
      }
    }
  })
  query_sql = null
  tags      = null
}

# __generated__ by OpenTofu from "549883/10892219"
resource "posthog_insight" "insight_10892219" {
  create_in_folder = null
  dashboard_ids    = [1977278]
  deleted          = false
  derived_name     = null
  description      = "This chart tracks which browsers your unique users have been using over the last 30 days. It can be useful to correlate this with which devices users have been using, so you can ensure compatibility. Hover over a section to reveal what proportion of your users each browser represents."
  name             = "What browsers do users prefer?"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown      = "$browser"
        breakdown_type = "event"
      }
      dateRange = {
        date_from    = "-30d"
        explicitDate = false
      }
      filterTestAccounts = true
      interval           = "day"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        event = "$pageview"
        kind  = "EventsNode"
        math  = "dau"
        name  = "$pageview"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsPie"
        showAlertThresholdLines = false
        showLegend              = false
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

# __generated__ by OpenTofu from "549883/11297201"
resource "posthog_insight" "insight_11297201" {
  create_in_folder = null
  dashboard_ids    = [2027696]
  deleted          = false
  derived_name     = null
  description      = "Deduplicated member activity split by command versus button surface."
  name             = "Bryan Bucks activity by betting surface"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown_type = "event"
        breakdowns = [{
          property = "surface"
          type     = "event"
        }]
      }
      dateRange = {
        date_from                = "-90d"
        excludeIncompletePeriods = false
        explicitDate             = false
      }
      filterTestAccounts = false
      interval           = "day"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        event      = "bryan_bucks_member_activity"
        kind       = "EventsNode"
        math       = "hogql"
        math_hogql = "count(distinct uuid)"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsStackedBar"
        excludeBoxPlotOutliers  = true
        hideWeekends            = false
        legendPosition          = "bottom"
        metricColorByDirection  = false
        metricShowChange        = true
        metricSummary           = "total"
        resultCustomizationBy   = "value"
        showAlertThresholdLines = false
        showAnnotations         = true
        showLegend              = false
        showMultipleYAxes       = false
        showPercentStackView    = false
        showValuesOnSeries      = false
        smoothingIntervals      = 1
        stackBreakdownValues    = false
        yAxisScaleType          = "linear"
        yAxisStartAtZero        = true
      }
    }
  })
  query_sql = null
  tags      = null
}

# __generated__ by OpenTofu from "549883/10892233"
resource "posthog_insight" "insight_10892233" {
  create_in_folder = null
  dashboard_ids    = [1977280]
  deleted          = false
  derived_name     = null
  description      = null
  name             = "Organic SEO Unique Users (Breakdown)"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown_type = "event"
      }
      dateRange = {
        date_from    = "-30d"
        explicitDate = false
      }
      filterTestAccounts = false
      interval           = "week"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        event = "$pageview"
        kind  = "EventsNode"
        math  = "dau"
        name  = "$pageview"
        properties = [{
          key      = "$referring_domain"
          operator = "icontains"
          type     = "event"
          value    = "google"
          }, {
          key      = "utm_source"
          operator = "is_not_set"
          type     = "event"
          value    = "is_not_set"
        }]
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsBar"
        showAlertThresholdLines = false
        showLegend              = false
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

# __generated__ by OpenTofu from "549883/10892227"
resource "posthog_insight" "insight_10892227" {
  create_in_folder = null
  dashboard_ids    = [1977279]
  deleted          = false
  derived_name     = null
  description      = "Shows the most common referring domains for your users over the past 14 days."
  name             = "Referring domain (last 14 days)"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      breakdownFilter = {
        breakdown      = "$referring_domain"
        breakdown_type = "event"
      }
      dateRange = {
        date_from    = "-14d"
        explicitDate = false
      }
      filterTestAccounts = false
      interval           = "day"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        event = "$pageview"
        kind  = "EventsNode"
        math  = "dau"
        name  = "$pageview"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsBarValue"
        showAlertThresholdLines = false
        showLegend              = false
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

# __generated__ by OpenTofu from "549883/11251174"
resource "posthog_insight" "insight_11251174" {
  create_in_folder = null
  dashboard_ids    = [2022116]
  deleted          = false
  derived_name     = null
  description      = "Unique guild_id receiving any core output (prematch, postmatch, reports, competitions) per day."
  name             = "Daily active guilds"
  project_id       = "549883"
  query_json = jsonencode({
    kind = "InsightVizNode"
    source = {
      dateRange = {
        date_from                = "-30d"
        excludeIncompletePeriods = false
        explicitDate             = false
      }
      filterTestAccounts = false
      interval           = "day"
      kind               = "TrendsQuery"
      properties         = []
      series = [{
        event      = "core_output_delivered"
        kind       = "EventsNode"
        math       = "hogql"
        math_hogql = "count(DISTINCT properties.guild_id)"
        name       = "Active guilds"
      }]
      trendsFilter = {
        aggregationAxisFormat   = "numeric"
        display                 = "ActionsLineGraph"
        excludeBoxPlotOutliers  = true
        hideWeekends            = false
        legendPosition          = "bottom"
        metricColorByDirection  = false
        metricShowChange        = true
        metricSummary           = "total"
        resultCustomizationBy   = "value"
        showAlertThresholdLines = false
        showAnnotations         = true
        showLegend              = false
        showMultipleYAxes       = false
        showPercentStackView    = false
        showValuesOnSeries      = false
        smoothingIntervals      = 1
        stackBreakdownValues    = false
        yAxisScaleType          = "linear"
        yAxisStartAtZero        = true
      }
    }
  })
  query_sql = null
  tags      = null
}
