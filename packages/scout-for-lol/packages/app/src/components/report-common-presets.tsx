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
        <div className="grid gap-2 sm:grid-cols-2">
          {REPORT_COMMON_PRESETS.map((preset) => (
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
      </CardContent>
    </Card>
  );
}
