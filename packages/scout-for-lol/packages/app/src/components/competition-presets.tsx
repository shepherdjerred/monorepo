import { Trophy } from "lucide-react";
import {
  COMPETITION_EXAMPLES,
  type CompetitionExample,
} from "#src/lib/onboarding-examples.ts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "#src/components/ui/card.tsx";
import { Button } from "#src/components/ui/button.tsx";

export function CompetitionPresets(props: {
  onUsePreset: (example: CompetitionExample) => void;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Presets</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 sm:grid-cols-2">
          {COMPETITION_EXAMPLES.map((example) => (
            <Button
              key={example.id}
              type="button"
              variant="outline"
              className="h-auto justify-start whitespace-normal p-3 text-left"
              onClick={() => {
                props.onUsePreset(example);
              }}
            >
              <Trophy className="mt-0.5" />
              <span className="space-y-1">
                <span className="block text-sm font-medium leading-5">
                  {example.label}
                </span>
                <span className="block text-xs font-normal leading-4 text-muted-foreground">
                  {example.description}
                </span>
              </span>
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
