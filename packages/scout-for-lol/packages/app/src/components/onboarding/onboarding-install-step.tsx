import { Button } from "#src/components/ui/button.tsx";
import { Card, CardContent } from "#src/components/ui/card.tsx";
import {
  discordInviteUrl,
  DISCORD_INSTALL_REDIRECTS_BACK,
} from "#src/lib/discord-invite.ts";
import { OnboardingShell } from "#src/components/onboarding/onboarding-shell.tsx";

export function OnboardingInstallStep(props: {
  guildCount: number;
  isLoading: boolean;
  onRefresh: () => void;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const hasGuilds = props.guildCount > 0;
  return (
    <OnboardingShell
      step="install"
      title="Add Scout to your server"
      description="Scout watches League games and posts a match report to a Discord channel after every game. First, add the bot to a server you manage."
      onSkip={props.onSkip}
    >
      <div className="space-y-4">
        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="text-sm text-muted-foreground">
              {DISCORD_INSTALL_REDIRECTS_BACK ? (
                <>
                  Pick a server and approve permissions (you need{" "}
                  <strong>Manage Server</strong>). Discord brings you right back
                  here when you&apos;re done.
                </>
              ) : (
                <>
                  Opens Discord in a new tab. Pick a server and approve
                  permissions (you need <strong>Manage Server</strong>). Once
                  you&apos;ve added Scout, return to this tab and your server
                  shows up below.
                </>
              )}
            </p>
            <Button
              onClick={() => {
                // Build the URL at click time so the `state` nonce is minted
                // fresh (and `window`/`crypto` aren't touched on render).
                const url = discordInviteUrl();
                if (DISCORD_INSTALL_REDIRECTS_BACK) {
                  globalThis.window.location.assign(url);
                } else {
                  globalThis.window.open(url, "_blank", "noreferrer");
                }
              }}
            >
              Add Scout to Discord
            </Button>
          </CardContent>
        </Card>

        {hasGuilds ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 p-3">
            <p className="text-sm">
              Scout is in {props.guildCount.toString()}{" "}
              {props.guildCount === 1 ? "server" : "servers"} you manage.
            </p>
            <Button onClick={props.onContinue}>Continue</Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
            <p className="text-sm text-muted-foreground">
              {props.isLoading
                ? "Checking your servers…"
                : "Already added it? Refresh to continue."}
            </p>
            <Button
              variant="outline"
              onClick={props.onRefresh}
              disabled={props.isLoading}
            >
              Refresh
            </Button>
          </div>
        )}
      </div>
    </OnboardingShell>
  );
}
