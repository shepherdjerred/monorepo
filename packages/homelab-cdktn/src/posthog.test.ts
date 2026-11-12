import path from "node:path";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { synthesize } from "#scripts/synth.ts";

const ConfigurationSchema = z.looseObject({
  terraform: z.looseObject({
    encryption: z.unknown(),
    required_providers: z.record(
      z.string(),
      z.object({ source: z.string(), version: z.string() }),
    ),
  }),
  provider: z.record(z.string(), z.unknown()),
  variable: z.record(z.string(), z.unknown()),
  locals: z.record(z.string(), z.record(z.string(), z.unknown())),
  resource: z.record(
    z.string(),
    z.record(z.string(), z.record(z.string(), z.unknown())),
  ),
  import: z.array(z.strictObject({ to: z.string(), id: z.string() })),
  moved: z.unknown().optional(),
  removed: z.unknown().optional(),
  output: z.unknown().optional(),
});

const RegistrySchema = z.looseObject({
  sites: z.array(
    z.looseObject({ hostname: z.string(), sessionReplay: z.boolean() }),
  ),
});

async function posthog() {
  const synthesized = await synthesize();
  return ConfigurationSchema.parse(
    JSON.parse(synthesized.get("posthog") ?? ""),
  );
}

/** PostHog ids of the dashboards adopted with their tile layouts. */
const ADOPTED_DASHBOARDS = [
  1_975_723, 1_977_268, 1_977_278, 1_977_279, 1_977_280, 2_022_116,
];

/** PostHog ids of the adopted insights. */
const ADOPTED_INSIGHTS = [
  10_881_550, 10_881_551, 10_881_552, 10_881_553, 10_881_554, 10_881_555,
  10_881_556, 10_881_557, 10_892_176, 10_892_177, 10_892_178, 10_892_179,
  10_892_180, 10_892_181, 10_892_182, 10_892_183, 10_892_185, 10_892_186,
  10_892_212, 10_892_213, 10_892_214, 10_892_215, 10_892_216, 10_892_217,
  10_892_218, 10_892_219, 10_892_220, 10_892_223, 10_892_224, 10_892_225,
  10_892_226, 10_892_227, 10_892_228, 10_892_230, 10_892_231, 10_892_232,
  10_892_233, 10_892_234, 10_892_235, 10_892_236, 10_892_237, 10_892_238,
  11_251_173, 11_251_174, 11_251_182, 11_251_183, 11_251_184, 11_251_185,
];

const ORGANIZATION = "019fe7f8-ecce-0000-adca-fe93618022c7";
const PROJECT = "549883";

/** Every adopted object: its address and the PostHog id it was imported from. */
const IMPORTS: Record<string, string> = {
  "posthog_cohort.internal_test_users": `${PROJECT}/469393`,
  "posthog_external_data_source.pinterest_ads": `${PROJECT}/019fea2b-19c4-0000-44e0-a7cc6f88a65b`,
  "posthog_hog_function.geoip": `${PROJECT}/019fe7f8-ee1c-0000-8f3e-476e8dac0c40`,
  "posthog_organization_member.owner": `${ORGANIZATION}/019fe7f8-ecd5-0000-33c2-62f36e0cec32`,
  "posthog_project.monorepo": `${ORGANIZATION}/${PROJECT}`,
  "posthog_project_settings.monorepo": PROJECT,
  "posthog_proxy_record.j_sjer_red": `${ORGANIZATION}/019fea37-95d4-0000-a853-32ba533f6f8c`,
  ...Object.fromEntries(
    ADOPTED_DASHBOARDS.flatMap((id) => [
      [
        `posthog_dashboard.dashboard_${id.toString()}`,
        `${PROJECT}/${id.toString()}`,
      ],
      [
        `posthog_dashboard_layout.dashboard_${id.toString()}`,
        `${PROJECT}/${id.toString()}`,
      ],
    ]),
  ),
  ...Object.fromEntries(
    ADOPTED_INSIGHTS.map((id) => [
      `posthog_insight.insight_${id.toString()}`,
      `${PROJECT}/${id.toString()}`,
    ]),
  ),
};

/** Objects the stack created, which have no import. */
const CREATED = [
  "posthog_dashboard.scout_feature_usage",
  "posthog_dashboard.storm_product_metrics",
  "posthog_insight.scout_creation_usage_weekly",
  "posthog_insight.scout_discord_commands_by_name",
  "posthog_insight.scout_progression_actions_weekly",
  "posthog_insight.scout_voice_questions_by_outcome",
  "posthog_insight.storm_product_metrics",
];

describe("posthog", () => {
  test("keeps the addresses of its state", async () => {
    const { resource, moved, removed, output } = await posthog();
    expect(
      Object.entries(resource)
        .flatMap(([type, byName]) =>
          Object.keys(byName).map((name) => `${type}.${name}`),
        )
        .toSorted(),
    ).toEqual([...Object.keys(IMPORTS), ...CREATED].toSorted());
    expect(moved).toBeUndefined();
    expect(removed).toBeUndefined();
    expect(output).toBeUndefined();
  });

  test("imports every adopted object at its PostHog id and nothing it created", async () => {
    const { import: imports } = await posthog();
    expect(imports).toHaveLength(67);
    expect(
      Object.fromEntries(imports.map((block) => [block.to, block.id])),
    ).toEqual(IMPORTS);
  });

  test("refuses to destroy the project, its owner, the proxy record and the ads source", async () => {
    const { resource } = await posthog();
    const protectedAddresses = Object.entries(resource).flatMap(
      ([type, byName]) =>
        Object.entries(byName)
          .filter(([, body]) => body["lifecycle"] !== undefined)
          .map(([name, body]) => [`${type}.${name}`, body["lifecycle"]]),
    );
    expect(Object.fromEntries(protectedAddresses)).toEqual({
      "posthog_external_data_source.pinterest_ads": { prevent_destroy: true },
      "posthog_organization_member.owner": { prevent_destroy: true },
      "posthog_project.monorepo": { prevent_destroy: true },
      "posthog_proxy_record.j_sjer_red": { prevent_destroy: true },
    });
  });

  test("keeps the provider, its constraint and the key provider its state records", async () => {
    const { terraform, provider, variable } = await posthog();
    expect(terraform.required_providers).toEqual({
      posthog: { source: "posthog/posthog", version: "~> 1.0" },
    });
    expect(provider).toEqual({
      posthog: [{ organization_id: ORGANIZATION, project_id: PROJECT }],
    });
    // Encrypted state names its key provider; another name cannot read it.
    expect(terraform.encryption).toEqual({
      key_provider: {
        pbkdf2: { posthog: { passphrase: "${var.state_passphrase}" } },
      },
      method: {
        aes_gcm: { posthog: { keys: "${key_provider.pbkdf2.posthog}" } },
      },
      state: { method: "method.aes_gcm.posthog", enforced: true },
      plan: { method: "method.aes_gcm.posthog", enforced: true },
    });
    expect(variable).toEqual({
      state_passphrase: {
        description:
          "Passphrase used to encrypt this stack's state and plan data.",
        sensitive: true,
        type: "string",
        validation: [
          {
            condition: "${(length(var.state_passphrase) >= 16)}",
            error_message:
              "The PostHog state passphrase must contain at least 16 characters.",
          },
        ],
      },
    });
  });

  test("encodes every insight query in OpenTofu from an object whose keys are data", async () => {
    const { resource, locals } = await posthog();
    const insights = resource["posthog_insight"] ?? {};
    const queries = locals["insight_queries"] ?? {};
    const single = Object.keys(insights).filter(
      (name) => name !== "storm_product_metrics",
    );
    expect(Object.keys(queries).toSorted()).toEqual(single.toSorted());
    for (const name of single) {
      expect(insights[name]?.["query_json"], name).toBe(
        `\${jsonencode(local.insight_queries["${name}"])}`,
      );
    }
    // PostHog's own field names and event names, not snake_cased or escaped.
    expect(queries["insight_10892183"]).toMatchObject({
      kind: "InsightVizNode",
      source: {
        breakdownFilter: { breakdown_type: "event" },
        filterTestAccounts: true,
        series: [{ event: "$pageview", kind: "EventsNode", math: "dau" }],
        trendsFilter: { display: "BoldNumber", yAxisScaleType: "linear" },
      },
    });
    expect(insights["insight_10892183"]).toMatchObject({
      dashboard_ids: [1_977_268],
      deleted: false,
      name: "Unique Users on Landing Page(s)",
      project_id: PROJECT,
    });
    expect(insights["scout_discord_commands_by_name"]).toMatchObject({
      dashboard_ids: ["${tonumber(posthog_dashboard.scout_feature_usage.id)}"],
    });
  });

  test("keeps the Storm insights' instance keys and their encoded query", async () => {
    const { resource, locals } = await posthog();
    expect(Object.keys(locals["storm_metrics"] ?? {})).toEqual([
      "active_players",
      "features",
      "first_sessions",
      "modes",
      "new_returning",
      "playtime",
      "retention",
      "sessions",
    ]);
    expect(resource["posthog_insight"]?.["storm_product_metrics"]).toEqual({
      for_each: "${local.storm_metrics}",
      dashboard_ids: [
        "${tonumber(posthog_dashboard.storm_product_metrics.id)}",
      ],
      deleted: false,
      description: "${each.value.description}",
      name: "${each.value.name}",
      project_id: PROJECT,
      query_json:
        '${jsonencode({ kind = "DataVisualizationNode", display = each.value.display, source = { kind = "HogQLQuery", query = each.value.query, filters = { dateRange = { date_from = "-90d", date_to = null } } } })}',
    });
    // Every metric reads the same deduplicated production event set, whose
    // `{filters}` placeholder PostHog fills in.
    const metrics = z
      .record(z.string(), z.looseObject({ query: z.string() }))
      .parse(locals["storm_metrics"]);
    for (const [name, metric] of Object.entries(metrics)) {
      expect(metric.query, name).toContain(
        "AND properties.event_id IS NOT NULL AND {filters}\n)",
      );
      expect(metric.query, name).not.toContain("${");
    }
  });

  test("positions tiles from layouts encoded in OpenTofu and leaves the rest to PostHog", async () => {
    const { resource, locals } = await posthog();
    const layouts = resource["posthog_dashboard_layout"] ?? {};
    const tileLayouts = locals["dashboard_tile_layouts"] ?? {};
    expect(layouts["dashboard_1977280"]).toMatchObject({
      dashboard_id: 1_977_280,
      project_id: PROJECT,
    });
    const tiles = z
      .array(z.record(z.string(), z.unknown()))
      .parse(layouts["dashboard_1977280"]?.["tiles"]);
    expect(tiles).toHaveLength(9);
    expect(tiles[0]).toEqual({
      color: "blue",
      insight_id: 10_892_230,
      layouts_json:
        '${jsonencode(local.dashboard_tile_layouts["dashboard_1977280"][0])}',
    });
    expect(tileLayouts["dashboard_1977280"]).toHaveLength(9);
    expect(tileLayouts["dashboard_1977280"]).toContainEqual({
      sm: { h: 5, i: "21", minH: 5, minW: 3, w: 6, x: 0, y: 0 },
      xs: { h: 5, i: "21", minH: 5, minW: 1, w: 1, x: 0, y: 0 },
    });
    // Scout Growth & Retention has no stored positions.
    expect(layouts["dashboard_2022116"]?.["tiles"]).toEqual([
      { insight_id: 11_251_185 },
      { insight_id: 11_251_184 },
      { insight_id: 11_251_183 },
      { insight_id: 11_251_182 },
      { insight_id: 11_251_174 },
      { insight_id: 11_251_173 },
    ]);
  });

  test("allows capture from every registered site and filters internal traffic by cohort", async () => {
    const { resource } = await posthog();
    const { sites } = RegistrySchema.parse(
      await Bun.file(
        path.join(import.meta.dir, "../../../config/analytics-sites.json"),
      ).json(),
    );
    expect(resource["posthog_project_settings"]?.["monorepo"]).toEqual({
      app_urls: sites.map((site) => `https://${site.hostname}`),
      autocapture_web_vitals_opt_in: true,
      capture_performance_opt_in: true,
      cookieless_server_hash_mode: 0,
      heatmaps_opt_in: true,
      project_id: PROJECT,
      recording_domains: sites
        .filter((site) => site.sessionReplay)
        .map((site) => `https://${site.hostname}`),
      session_recording_opt_in: true,
      test_account_filters:
        '${jsonencode([{"key" = "id", "operator" = "not_in", "type" = "cohort", "value" = posthog_cohort.internal_test_users.id}])}',
    });
  });
});
