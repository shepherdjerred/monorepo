import { Button } from "#src/components/ui/button.tsx";
import { OnboardingShell } from "#src/components/onboarding/onboarding-shell.tsx";

type Guild = {
  id: string;
  name: string;
  icon: string | null;
  isOwner: boolean;
};

export function OnboardingPickGuildStep(props: {
  guilds: Guild[];
  onSelect: (guildId: string) => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  return (
    <OnboardingShell
      step="pick-guild"
      title="Which server?"
      description="Pick the server you want to set Scout up in. You can do the others later."
      onSkip={props.onSkip}
    >
      <div className="space-y-4">
        <ul className="grid gap-2">
          {props.guilds.map((g) => (
            <li key={g.id}>
              <button
                type="button"
                onClick={() => {
                  props.onSelect(g.id);
                }}
                className="flex w-full items-center gap-3 rounded-md border border-border bg-card p-3 text-left text-card-foreground transition-colors hover:bg-accent"
              >
                {g.icon === null ? (
                  <div className="h-8 w-8 shrink-0 rounded-md bg-muted" />
                ) : (
                  <img
                    src={`https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64`}
                    alt=""
                    width={32}
                    height={32}
                    className="h-8 w-8 shrink-0 rounded-md"
                  />
                )}
                <span className="flex-1 truncate font-medium">{g.name}</span>
                {g.isOwner && (
                  <span className="text-xs text-muted-foreground">owner</span>
                )}
              </button>
            </li>
          ))}
        </ul>
        <Button variant="ghost" onClick={props.onBack}>
          ← Back
        </Button>
      </div>
    </OnboardingShell>
  );
}
