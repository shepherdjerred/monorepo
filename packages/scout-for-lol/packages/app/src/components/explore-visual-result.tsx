import { useMemo, useState } from "react";
import { BarChart2, Table as TableIcon, X } from "lucide-react";
import {
  ReportOutputFormatSchema,
  type ExploreMessage,
  type ReportAiPreviewSummary,
  type ReportOutputFormat,
  type ReportResultColumn,
  type VisualizationSnapshot,
} from "@scout-for-lol/data";
import { isChartRenderKind } from "@scout-for-lol/data/model/scoutql/catalog-render-kinds.ts";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@scout-for-lol/design-system/components/select";
import { InteractiveVisualization } from "#src/components/interactive-visualization.tsx";
import { ReportResultTable } from "#src/components/report-result-table.tsx";
import {
  SingleRowResult,
  isUngroupedResult,
} from "#src/components/explore-result.tsx";
import {
  isChartablePreview,
  plottableMetricColumns,
  previewToVisualizationSnapshot,
} from "#src/lib/preview-to-visualization.ts";

function chartableSnapshot(
  snapshot: VisualizationSnapshot | null,
): VisualizationSnapshot | null {
  if (snapshot === null) {
    return null;
  }
  const format = ReportOutputFormatSchema.safeParse(
    snapshot.kind.toUpperCase(),
  );
  return format.success && isChartRenderKind(format.data) ? snapshot : null;
}

export function initialChartKind(
  rawChart: VisualizationSnapshot | null,
  preview: ReportAiPreviewSummary | null,
): ReportOutputFormat {
  if (rawChart !== null) {
    const format = ReportOutputFormatSchema.safeParse(
      rawChart.kind.toUpperCase(),
    );
    if (format.success && isChartRenderKind(format.data)) {
      return format.data;
    }
  }

  if (preview !== null && isChartRenderKind(preview.renderKind)) {
    return preview.renderKind;
  }

  return "BAR_CHART";
}

function initialChartOrientation(
  rawChart: VisualizationSnapshot | null,
): "vertical" | "horizontal" {
  if (rawChart === null) {
    return "vertical";
  }
  return rawChart.display.options?.orientation ?? "vertical";
}

export type ExploreVisualResultProps = {
  readonly message: ExploreMessage;
  readonly onFollowUp?: ((text: string) => void) | undefined;
};

type SelectedDataPoint = {
  label: string;
  value: number | null;
  seriesName?: string | undefined;
};

function ExploreViewTabs(props: {
  readonly activeTab: "chart" | "table";
  readonly onTabChange: (tab: "chart" | "table") => void;
}) {
  const { activeTab, onTabChange } = props;
  return (
    <div className="inline-flex rounded-md border border-scout-border bg-scout-surface p-0.5">
      <button
        type="button"
        onClick={() => {
          onTabChange("chart");
        }}
        className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
          activeTab === "chart"
            ? "bg-scout-panel text-scout-ink shadow-sm"
            : "text-scout-subtle hover:text-scout-ink"
        }`}
      >
        <BarChart2 className="size-3.5" />
        Chart
      </button>
      <button
        type="button"
        onClick={() => {
          onTabChange("table");
        }}
        className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
          activeTab === "table"
            ? "bg-scout-panel text-scout-ink shadow-sm"
            : "text-scout-subtle hover:text-scout-ink"
        }`}
      >
        <TableIcon className="size-3.5" />
        Table
      </button>
    </div>
  );
}

function ExploreChartControls(props: {
  readonly selectedChartKind: ReportOutputFormat;
  readonly orientation: "vertical" | "horizontal";
  readonly onChartKindChange: (
    kind: ReportOutputFormat,
    orientation: "vertical" | "horizontal",
  ) => void;
  readonly plottableCols: ReportResultColumn[];
  readonly selectedMetricKey: string | undefined;
  readonly onMetricChange: (metricKey: string) => void;
}) {
  const {
    selectedChartKind,
    orientation,
    onChartKindChange,
    plottableCols,
    selectedMetricKey,
    onMetricChange,
  } = props;

  const selectValue =
    selectedChartKind === "BAR_CHART" && orientation === "horizontal"
      ? "BAR_HORIZONTAL"
      : selectedChartKind;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="w-36">
        <Select
          value={selectValue}
          onValueChange={(val) => {
            switch (val) {
              case "BAR_HORIZONTAL": {
                onChartKindChange("BAR_CHART", "horizontal");
                break;
              }
              case "BAR_CHART": {
                onChartKindChange("BAR_CHART", "vertical");
                break;
              }
              case "LINE_CHART":
              case "DONUT_CHART":
              case "AREA_CHART": {
                onChartKindChange(val, "vertical");
                break;
              }
            }
          }}
        >
          <SelectTrigger className="h-7 text-xs">
            <SelectValue placeholder="Chart Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="BAR_CHART">Bar (Vertical)</SelectItem>
            <SelectItem value="BAR_HORIZONTAL">Bar (Horizontal)</SelectItem>
            <SelectItem value="LINE_CHART">Line Chart</SelectItem>
            <SelectItem value="DONUT_CHART">Donut Chart</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {plottableCols.length > 1 && (
        <div className="w-36">
          <Select
            value={selectedMetricKey ?? plottableCols[0]?.key ?? ""}
            onValueChange={onMetricChange}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="Metric" />
            </SelectTrigger>
            <SelectContent>
              {plottableCols.map((col) => (
                <SelectItem key={col.key} value={col.key}>
                  {col.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

function ExploreDrillDownBar(props: {
  readonly selectedPoint: SelectedDataPoint;
  readonly onFollowUp?: ((text: string) => void) | undefined;
  readonly onDismiss: () => void;
}) {
  const { selectedPoint, onFollowUp, onDismiss } = props;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-scout-border bg-scout-surface p-2.5 text-xs animate-in fade-in-50">
      <span className="font-medium text-scout-ink">{selectedPoint.label}</span>
      {onFollowUp !== undefined && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => {
              onFollowUp(`Tell me more about ${selectedPoint.label}`);
            }}
          >
            Ask about {selectedPoint.label}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => {
              onFollowUp(`How has ${selectedPoint.label} performed over time?`);
            }}
          >
            Trend over time
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => {
              onFollowUp(
                `What are the best builds or matchups for ${selectedPoint.label}?`,
              );
            }}
          >
            Matchups & builds
          </Button>
        </div>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        className="ml-auto size-6 text-scout-subtle hover:text-scout-ink"
        onClick={onDismiss}
        title="Clear selection"
      >
        <X className="size-3" />
      </Button>
    </div>
  );
}

function resolveActiveSnapshot(options: {
  preview: ReportAiPreviewSummary | null;
  isPreviewChartable: boolean;
  rawChart: VisualizationSnapshot | null;
  hasCustomChartSelection: boolean;
  selectedChartKind: ReportOutputFormat;
  selectedMetricKey: string | undefined;
  orientation: "vertical" | "horizontal";
}): VisualizationSnapshot | null {
  const {
    preview,
    isPreviewChartable,
    rawChart,
    hasCustomChartSelection,
    selectedChartKind,
    selectedMetricKey,
    orientation,
  } = options;

  if (rawChart !== null && !hasCustomChartSelection) {
    return rawChart;
  }

  if (preview !== null && isPreviewChartable) {
    const synthesized = previewToVisualizationSnapshot(preview, {
      preferredKind: selectedChartKind,
      metricKey: selectedMetricKey,
      orientation,
    });
    if (synthesized !== null) {
      return synthesized;
    }
  }

  if (rawChart !== null) {
    if (selectedChartKind === "BAR_CHART" && orientation === "horizontal") {
      return {
        ...rawChart,
        kind: "BAR_CHART",
        display: {
          ...rawChart.display,
          options: {
            ...rawChart.display.options,
            orientation: "horizontal",
          },
        },
      };
    }
    return {
      ...rawChart,
      kind: selectedChartKind,
    };
  }

  return null;
}

export function ExploreVisualResult(props: {
  readonly message: ExploreMessage;
  readonly onFollowUp?: ((text: string) => void) | undefined;
}) {
  const { message, onFollowUp } = props;
  const rawChart = chartableSnapshot(message.visualization);
  const preview = message.preview;

  const isUngrouped = preview !== null && isUngroupedResult(preview);
  const isPreviewChartable = isChartablePreview(preview);
  const canShowChart = rawChart !== null || isPreviewChartable;
  const canShowTable = preview !== null && preview.rows.length > 0;

  const initialTab = rawChart === null ? "table" : "chart";
  const [activeTab, setActiveTab] = useState<"chart" | "table">(initialTab);

  const plottableCols = useMemo(
    () => (preview ? plottableMetricColumns(preview.columns) : []),
    [preview],
  );

  const [selectedMetricKey, setSelectedMetricKey] = useState<
    string | undefined
  >(plottableCols[0]?.key);

  const [selectedChartKind, setSelectedChartKind] =
    useState<ReportOutputFormat>(() => initialChartKind(rawChart, preview));

  const [orientation, setOrientation] = useState<"vertical" | "horizontal">(
    () => initialChartOrientation(rawChart),
  );

  const [hasCustomChartSelection, setHasCustomChartSelection] = useState(false);

  const [selectedPoint, setSelectedPoint] = useState<SelectedDataPoint | null>(
    null,
  );

  const activeSnapshot = useMemo(
    (): VisualizationSnapshot | null =>
      resolveActiveSnapshot({
        preview,
        isPreviewChartable,
        rawChart,
        hasCustomChartSelection,
        selectedChartKind,
        selectedMetricKey,
        orientation,
      }),
    [
      preview,
      isPreviewChartable,
      rawChart,
      hasCustomChartSelection,
      selectedChartKind,
      selectedMetricKey,
      orientation,
    ],
  );

  if (isUngrouped) {
    return <SingleRowResult preview={preview} />;
  }

  if (!canShowChart && !canShowTable) {
    return null;
  }

  const showViewSwitcher = canShowChart && canShowTable;

  return (
    <div className="space-y-2">
      {showViewSwitcher && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ExploreViewTabs activeTab={activeTab} onTabChange={setActiveTab} />

          {activeTab === "chart" && (
            <ExploreChartControls
              selectedChartKind={selectedChartKind}
              orientation={orientation}
              onChartKindChange={(kind, orient) => {
                setHasCustomChartSelection(true);
                setSelectedChartKind(kind);
                setOrientation(orient);
              }}
              plottableCols={plottableCols}
              selectedMetricKey={selectedMetricKey}
              onMetricChange={(val) => {
                setHasCustomChartSelection(true);
                setSelectedMetricKey(val);
              }}
            />
          )}
        </div>
      )}

      {activeTab === "chart" && activeSnapshot !== null && (
        <InteractiveVisualization
          snapshot={activeSnapshot}
          onPointClick={(label, value, seriesName) => {
            setSelectedPoint({ label, value, seriesName });
          }}
        />
      )}

      {(activeTab === "table" || !canShowChart) && preview !== null && (
        <ReportResultTable
          columns={preview.columns}
          rows={preview.rows}
          visualization={message.visualization}
          interactive={true}
          onRowClick={(row) => {
            setSelectedPoint({ label: row.label, value: null });
          }}
        />
      )}

      {selectedPoint !== null && (
        <ExploreDrillDownBar
          selectedPoint={selectedPoint}
          onFollowUp={onFollowUp}
          onDismiss={() => {
            setSelectedPoint(null);
          }}
        />
      )}
    </div>
  );
}
