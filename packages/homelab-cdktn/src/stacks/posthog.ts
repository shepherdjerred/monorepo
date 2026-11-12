import path from "node:path";
import type { Construct } from "constructs";
import { Fn, TerraformIterator, TerraformLocal, Token, ref } from "cdktn";
import { z } from "zod";
import { Cohort } from "#generated/providers/posthog/cohort/index.ts";
import { Dashboard } from "#generated/providers/posthog/dashboard/index.ts";
import { DashboardLayout } from "#generated/providers/posthog/dashboard-layout/index.ts";
import { ExternalDataSource } from "#generated/providers/posthog/external-data-source/index.ts";
import { HogFunction } from "#generated/providers/posthog/hog-function/index.ts";
import { Insight } from "#generated/providers/posthog/insight/index.ts";
import { OrganizationMember } from "#generated/providers/posthog/organization-member/index.ts";
import { Project } from "#generated/providers/posthog/project/index.ts";
import { ProjectSettings } from "#generated/providers/posthog/project-settings/index.ts";
import { PosthogProvider } from "#generated/providers/posthog/provider/index.ts";
import { ProxyRecord } from "#generated/providers/posthog/proxy-record/index.ts";
import { encryptStateAndPlans } from "#src/encryption.ts";
import { HomelabStack } from "#src/homelab-stack.ts";
import { adopt } from "#src/state-migrations.ts";
import { ADOPTED } from "#src/stacks/posthog/adopted.ts";
import {
  FEATURE_USAGE_DASHBOARD,
  FEATURE_USAGE_INSIGHTS,
} from "#src/stacks/posthog/feature-usage.ts";
import {
  STORM_DASHBOARD,
  STORM_METRICS,
} from "#src/stacks/posthog/storm-product-metrics.ts";

const ORGANIZATION_ID = "019fe7f8-ecce-0000-adca-fe93618022c7";
const PROJECT_ID = "549883";

const AnalyticsRegistrySchema = z.looseObject({
  sites: z.array(
    z.looseObject({ hostname: z.string(), sessionReplay: z.boolean() }),
  ),
});

/**
 * Every first-party site that reports to PostHog. The registry is imported
 * rather than read with file(), so a registry change reaches the stack
 * through a re-synthesis that review sees.
 */
const ANALYTICS_SITES = AnalyticsRegistrySchema.parse(
  await Bun.file(
    path.join(import.meta.dir, "../../../../config/analytics-sites.json"),
  ).json(),
).sites;

type Json = z.core.util.JSONType;

/** In JSON syntax every string is a template; these sequences open one. */
function escapeTemplate(text: string): string {
  return text.replaceAll("${", "$${").replaceAll("%{", "%%{");
}

function escapeTemplates(node: Json): Json {
  if (typeof node === "string") return escapeTemplate(node);
  if (Array.isArray(node)) return node.map((item) => escapeTemplates(item));
  return typeof node === "object" && node !== null
    ? Object.fromEntries(
        Object.entries(node).map(([key, child]) => [
          escapeTemplate(key),
          escapeTemplates(child),
        ]),
      )
    : node;
}

/**
 * A JSON document handed to OpenTofu as a local value: its strings are
 * escaped so none is read as a template, and its keys are data, passed as-is
 * rather than snake_cased.
 */
function literal(value: Json): unknown {
  return Token.asAny(escapeTemplates(value));
}

/**
 * PostHog organization and project controls: the project and its settings,
 * the owner's membership, the reverse-proxy record, the Pinterest Ads source,
 * and every dashboard, tile layout and insight.
 *
 * Objects that predate the stack live in `posthog/adopted.json`; the
 * dashboards this repository designed are the TypeScript modules beside it.
 * Authenticated through POSTHOG_API_KEY, which the stack wrapper injects.
 */
export class PosthogStack extends HomelabStack {
  constructor(scope: Construct) {
    super(scope, "posthog", {
      requiredVersion: ">= 1.12.0",
      providerConstraints: { posthog: "~> 1.0" },
    });
    // The encrypted state records the key provider's address, so the stack
    // keeps the names its state was first written with.
    encryptStateAndPlans(this, {
      variable: "state_passphrase",
      keyProvider: "posthog",
      method: "posthog",
      description:
        "Passphrase used to encrypt this stack's state and plan data.",
      errorMessage:
        "The PostHog state passphrase must contain at least 16 characters.",
    });

    // Provider and resource construct ids share one scope, so the provider
    // takes an id no resource name uses; its address is its type.
    new PosthogProvider(this, "posthog_provider", {
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
    });

    this.addOrganization();
    this.addProjectSettings();
    this.addHogFunctions();
    this.addAdoptedDashboards();
    this.addInsights();
    this.addFeatureUsage();
    this.addStormProductMetrics();
  }

  /** The organization-level objects, none of which a plan may destroy. */
  private addOrganization(): void {
    // `monorepo` names both the project and its settings; construct ids are
    // unique per scope, so each takes a distinct id and keeps its address
    // through `overrideLogicalId`.
    const project = new Project(this, "project_monorepo", {
      name: "monorepo",
      organizationId: ORGANIZATION_ID,
      timezone: "America/Los_Angeles",
    });
    project.overrideLogicalId("monorepo");
    adopt(project, `${ORGANIZATION_ID}/${PROJECT_ID}`);

    adopt(
      new OrganizationMember(this, "owner", {
        level: "owner",
        organizationId: ORGANIZATION_ID,
        userUuid: "019fe7f8-ecd5-0000-33c2-62f36e0cec32",
      }),
      `${ORGANIZATION_ID}/019fe7f8-ecd5-0000-33c2-62f36e0cec32`,
    );

    adopt(
      new ProxyRecord(this, "j_sjer_red", {
        domain: "j.sjer.red",
        organizationId: ORGANIZATION_ID,
      }),
      `${ORGANIZATION_ID}/019fea37-95d4-0000-a853-32ba533f6f8c`,
    );

    adopt(
      new ExternalDataSource(this, "pinterest_ads", {
        jobInputsJson: Fn.jsonencode({
          ad_account_id: "549768245877",
          pinterest_ads_integration_id: "209503",
        }),
        projectId: PROJECT_ID,
        schemas: [
          "ad_accounts",
          "ad_analytics",
          "ad_group_analytics",
          "ad_groups",
          "ad_group_targeting_analytics",
          "ads",
          "ad_targeting_analytics",
          "audiences",
          "campaign_analytics",
          "campaigns",
          "campaign_targeting_analytics",
          "conversion_tags",
          "keywords",
        ],
        sourceType: "PinterestAds",
      }),
      `${PROJECT_ID}/019fea2b-19c4-0000-44e0-a7cc6f88a65b`,
    );
  }

  /** Capture settings, and the cohort that marks internal traffic. */
  private addProjectSettings(): void {
    const internalTestUsers = new Cohort(this, "internal_test_users", {
      deleted: false,
      description:
        "People who are internal team members or test users. Used for filtering out internal traffic from analytics.",
      filters: Fn.jsonencode({
        properties: {
          type: "OR",
          values: [
            {
              type: "AND",
              values: [
                {
                  key: "$internal_or_test_user",
                  operator: "exact",
                  type: "person",
                  value: [true],
                },
              ],
            },
            {
              type: "AND",
              values: [
                {
                  key: "email",
                  operator: "icontains",
                  type: "person",
                  value: "@sjer.red",
                },
              ],
            },
          ],
        },
      }),
      isStatic: false,
      name: "Internal / Test users",
      projectId: PROJECT_ID,
    });
    internalTestUsers.importFrom(`${PROJECT_ID}/469393`);

    const settings = new ProjectSettings(this, "project_settings_monorepo", {
      appUrls: ANALYTICS_SITES.map((site) => `https://${site.hostname}`),
      autocaptureWebVitalsOptIn: true,
      capturePerformanceOptIn: true,
      cookielessServerHashMode: 0,
      heatmapsOptIn: true,
      projectId: PROJECT_ID,
      recordingDomains: ANALYTICS_SITES.filter(
        (site) => site.sessionReplay,
      ).map((site) => `https://${site.hostname}`),
      sessionRecordingOptIn: true,
      testAccountFilters: Fn.jsonencode([
        {
          key: "id",
          operator: "not_in",
          type: "cohort",
          value: internalTestUsers.id,
        },
      ]),
    });
    settings.overrideLogicalId("monorepo");
    settings.importFrom(PROJECT_ID);
  }

  private addHogFunctions(): void {
    new TerraformLocal(
      this,
      "hog_function_filters",
      literal(
        Object.fromEntries(
          Object.entries(ADOPTED.hogFunctions).map(([id, hogFunction]) => [
            id,
            hogFunction.filters,
          ]),
        ),
      ),
    );
    for (const [id, hogFunction] of Object.entries(ADOPTED.hogFunctions)) {
      new HogFunction(this, id, {
        description: hogFunction.description,
        enabled: hogFunction.enabled,
        executionOrder: hogFunction.executionOrder,
        filtersJson: Fn.jsonencode(ref(`local.hog_function_filters["${id}"]`)),
        hog: hogFunction.hog,
        iconUrl: hogFunction.iconUrl,
        name: hogFunction.name,
        projectId: PROJECT_ID,
        templateId: hogFunction.templateId,
        type: hogFunction.type,
      }).importFrom(hogFunction.importId);
    }
  }

  /** The adopted dashboards and the position of every tile on them. */
  private addAdoptedDashboards(): void {
    for (const [id, dashboard] of Object.entries(ADOPTED.dashboards)) {
      new Dashboard(this, id, {
        deleted: false,
        description: dashboard.description,
        name: dashboard.name,
        pinned: dashboard.pinned,
        projectId: PROJECT_ID,
      }).importFrom(dashboard.importId);
    }

    // PostHog stores a tile's grid position as a JSON document; a tile
    // without one is placed by PostHog.
    new TerraformLocal(
      this,
      "dashboard_tile_layouts",
      literal(
        Object.fromEntries(
          Object.entries(ADOPTED.layouts).map(([id, layout]) => [
            id,
            layout.tiles.map((tile) => tile.layouts ?? null),
          ]),
        ),
      ),
    );
    for (const [id, layout] of Object.entries(ADOPTED.layouts)) {
      // A layout shares its dashboard's resource name.
      const resource = new DashboardLayout(this, `dashboard_layout_${id}`, {
        dashboardId: layout.dashboardId,
        projectId: PROJECT_ID,
        tiles: layout.tiles.map((tile, index) => ({
          color: tile.color,
          insightId: tile.insightId,
          layoutsJson:
            tile.layouts === undefined
              ? undefined
              : Fn.jsonencode(
                  ref(
                    `local.dashboard_tile_layouts["${id}"][${index.toString()}]`,
                  ),
                ),
          showDescription: tile.showDescription,
          textBody: tile.textBody,
        })),
      });
      resource.overrideLogicalId(id);
      resource.importFrom(layout.importId);
    }
  }

  /**
   * Every insight's query, keyed by resource name, as one local. `jsonencode`
   * runs in OpenTofu over the object, exactly as it did over the HCL object
   * literal each query was first written as.
   */
  private addInsights(): void {
    new TerraformLocal(
      this,
      "insight_queries",
      literal({
        ...Object.fromEntries(
          Object.entries(ADOPTED.insights).map(([id, insight]) => [
            id,
            insight.query,
          ]),
        ),
        ...Object.fromEntries(
          Object.entries(FEATURE_USAGE_INSIGHTS).map(([id, insight]) => [
            id,
            insight.query,
          ]),
        ),
      }),
    );
    for (const [id, insight] of Object.entries(ADOPTED.insights)) {
      new Insight(this, id, {
        dashboardIds: insight.dashboardIds,
        deleted: false,
        description: insight.description,
        name: insight.name,
        projectId: PROJECT_ID,
        queryJson: insightQuery(id),
      }).importFrom(insight.importId);
    }
  }

  private addFeatureUsage(): void {
    const dashboard = new Dashboard(this, FEATURE_USAGE_DASHBOARD.id, {
      deleted: false,
      description: FEATURE_USAGE_DASHBOARD.description,
      name: FEATURE_USAGE_DASHBOARD.name,
      pinned: false,
      projectId: PROJECT_ID,
    });
    for (const [id, insight] of Object.entries(FEATURE_USAGE_INSIGHTS)) {
      new Insight(this, id, {
        dashboardIds: [Fn.tonumber(dashboard.id)],
        deleted: false,
        description: insight.description,
        name: insight.name,
        projectId: PROJECT_ID,
        queryJson: insightQuery(id),
      });
    }
  }

  private addStormProductMetrics(): void {
    const dashboard = new Dashboard(this, STORM_DASHBOARD.id, {
      deleted: false,
      description: STORM_DASHBOARD.description,
      name: STORM_DASHBOARD.name,
      pinned: false,
      projectId: PROJECT_ID,
    });

    const metrics = new TerraformLocal(
      this,
      "storm_metrics",
      literal(STORM_METRICS),
    );
    const metric = TerraformIterator.fromMap(metrics.asAnyMap);
    // The dashboard and its insights share one resource name.
    new Insight(this, `insight_${STORM_DASHBOARD.id}`, {
      forEach: metric,
      dashboardIds: [Fn.tonumber(dashboard.id)],
      deleted: false,
      description: metric.getString("description"),
      name: metric.getString("name"),
      projectId: PROJECT_ID,
      // A whole-attribute expression, as the HCL wrote it.
      queryJson:
        '${jsonencode({ kind = "DataVisualizationNode", display = each.value.display, source = { kind = "HogQLQuery", query = each.value.query, filters = { dateRange = { date_from = "-90d", date_to = null } } } })}',
    }).overrideLogicalId(STORM_DASHBOARD.id);
  }
}

/** `jsonencode(local.insight_queries["<id>"])`. */
function insightQuery(id: string): string {
  return Fn.jsonencode(ref(`local.insight_queries["${id}"]`));
}
