import { FileText } from "lucide-react";
import {
  REPORT_COMMON_PRESETS,
  type ReportCommonPresetInfo,
} from "@scout-for-lol/data";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "#src/components/ui/card.tsx";
import { Button } from "#src/components/ui/button.tsx";

export function ReportCommonPresets(props: {
  onUsePreset: (preset: ReportCommonPresetInfo) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Common reports</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-5">
          {presetCategories().map(([category, presets]) => (
            <section key={category} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {category}
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {presets.map((preset) => (
                  <Button
                    key={preset.id}
                    type="button"
                    variant="outline"
                    className="h-auto justify-start whitespace-normal p-3 text-left"
                    onClick={() => {
                      props.onUsePreset(preset);
                    }}
                  >
                    <FileText className="mt-0.5" />
                    <span className="space-y-1">
                      <span className="block text-sm font-medium leading-5">
                        {preset.title}
                      </span>
                      <span className="block text-xs font-normal leading-4 text-muted-foreground">
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

function presetCategories(): [string, ReportCommonPresetInfo[]][] {
  const categories = new Map<string, ReportCommonPresetInfo[]>();
  for (const preset of REPORT_COMMON_PRESETS) {
    const category = preset.category ?? "Other";
    const existing = categories.get(category) ?? [];
    categories.set(category, [...existing, preset]);
  }
  return [...categories.entries()].toSorted(([left], [right]) =>
    left.localeCompare(right),
  );
}
