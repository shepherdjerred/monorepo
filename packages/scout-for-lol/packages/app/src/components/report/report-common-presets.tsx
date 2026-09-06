import { FileText } from "lucide-react";
import {
  SCOUTQL_PRESETS,
  type ScoutQlPreset,
} from "@scout-for-lol/data/model/scoutql/presets.ts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import { Button } from "@scout-for-lol/design-system/components/button";
import { track } from "#src/lib/analytics.ts";

export function ReportCommonPresets(props: {
  onUsePreset: (preset: ScoutQlPreset) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Presets</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-5">
          {presetCategories().map(([category, presets]) => (
            <section key={category} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-scout-subtle">
                {category}
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {presets.map((preset) => (
                  <Button
                    key={preset.id}
                    type="button"
                    variant="outline"
                    className="h-auto items-start justify-start whitespace-normal p-3 text-left"
                    onClick={() => {
                      track("report_preset_used", {
                        category: preset.category,
                      });
                      props.onUsePreset(preset);
                    }}
                  >
                    <FileText className="mt-0.5 size-5 shrink-0" />
                    <span className="w-full space-y-1 text-left">
                      <span className="block text-sm font-medium leading-5">
                        {preset.title}
                      </span>
                      <span className="block text-xs font-normal leading-4 text-scout-subtle">
                        {preset.description}
                      </span>
                    </span>
                  </Button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function presetCategories(): [string, ScoutQlPreset[]][] {
  const categories = new Map<string, ScoutQlPreset[]>();
  for (const preset of SCOUTQL_PRESETS) {
    const existing = categories.get(preset.category) ?? [];
    categories.set(preset.category, [...existing, preset]);
  }
  return [...categories.entries()].toSorted(([left], [right]) =>
    left.localeCompare(right),
  );
}
