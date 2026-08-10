import * as dashboard from "@grafana/grafana-foundation-sdk/dashboard";
import { addLlmPanels } from "./ai-provider-dashboard-llm.ts";
import { addProviderIssuePanels } from "./ai-provider-dashboard-legacy.ts";
import { PROMETHEUS_DATASOURCE } from "./ai-provider-dashboard-panels.ts";
import { exportDashboardWithHelmEscaping } from "./dashboard-export.ts";

function createVariable(options: {
  name: string;
  label: string;
  query: string;
}) {
  return new dashboard.QueryVariableBuilder(options.name)
    .label(options.label)
    .query(options.query)
    .datasource(PROMETHEUS_DATASOURCE)
    .multi(true)
    .includeAll(true)
    .allValue(".*");
}

function addVariables(builder: dashboard.DashboardBuilder): void {
  builder
    .withVariable(
      createVariable({
        name: "app",
        label: "App",
        query: "label_values(ai_provider_issue_active, app)",
      }),
    )
    .withVariable(
      createVariable({
        name: "provider",
        label: "Provider",
        query: 'label_values(ai_provider_errors_total{app=~"$app"}, provider)',
      }),
    )
    .withVariable(
      createVariable({
        name: "kind",
        label: "Kind",
        query:
          'label_values(ai_provider_errors_total{app=~"$app",provider=~"$provider"}, kind)',
      }),
    )
    .withVariable(
      createVariable({
        name: "source",
        label: "Source",
        query:
          'label_values(ai_provider_errors_total{app=~"$app",provider=~"$provider",kind=~"$kind"}, source)',
      }),
    )
    .withVariable(
      createVariable({
        name: "service",
        label: "LLM Service",
        query: "label_values(llm_requests_total, service)",
      }),
    )
    .withVariable(
      createVariable({
        name: "workload",
        label: "LLM Workload",
        query:
          'label_values(llm_requests_total{service=~"$service"}, workload)',
      }),
    )
    .withVariable(
      createVariable({
        name: "model",
        label: "LLM Model",
        query:
          'label_values(llm_requests_total{service=~"$service",workload=~"$workload"}, model)',
      }),
    );
}

export function createAiProviderDashboard() {
  const builder = new dashboard.DashboardBuilder("AI Provider Health")
    .uid("ai-provider-health")
    .tags(["ai", "providers", "alerts"])
    .time({ from: "now-24h", to: "now" })
    .refresh("30s")
    .timezone("browser")
    .editable();

  addVariables(builder);
  addProviderIssuePanels(builder);
  addLlmPanels(
    builder,
    'service=~"$service",workload=~"$workload",model=~"$model"',
  );
  return builder.build();
}

export function exportAiProviderDashboardJson(): string {
  return exportDashboardWithHelmEscaping(createAiProviderDashboard());
}
