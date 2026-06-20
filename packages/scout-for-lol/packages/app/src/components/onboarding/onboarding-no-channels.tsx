import { Button } from "#src/components/ui/button.tsx";
import { Card, CardContent } from "#src/components/ui/card.tsx";

/**
 * Blocking notice shown in the subscribe / report / competition steps when
 * Scout can't see any channel it is allowed to post in, so the user never
 * submits a blank channel.
 */
export function OnboardingNoChannels(props: { onBack: () => void }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          Scout can&apos;t see any channel it&apos;s allowed to post in. In your
          server settings, give the Scout bot access to a text channel (View
          Channel + Send Messages), then come back and refresh this page.
        </CardContent>
      </Card>
      <Button variant="ghost" onClick={props.onBack}>
        ← Back
      </Button>
    </div>
  );
}
