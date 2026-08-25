import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Card,
  CardContent,
} from "@scout-for-lol/design-system/components/card";
import { trackOutboundClick } from "#src/lib/analytics.ts";
import { OnboardingShell } from "#src/components/onboarding/onboarding-shell.tsx";

/**
 * The install button goes through the backend route (same-tab, like the guild
 * picker): it mints the attribution `state` token, 302s to Discord, and
 * Discord returns the user to /app/installed, which forwards into
 * /welcome?guild=… — resuming this wizard past the install step.
 */
const INSTALL_URL = "/api/discord/install?surface=onboarding_wizard";

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
      {...(hasGuilds ? { onSkip: props.onSkip } : {})}
    >
      <div className="space-y-4">
        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="text-sm text-scout-subtle">
              Pick a server and approve permissions (you need{" "}
              <strong>Manage Server</strong>). Discord brings you right back
              here when you&apos;re done.
            </p>
            <Button asChild>
              <a
                href={INSTALL_URL}
                onClick={(clickEvent) => {
                  trackOutboundClick(
                    clickEvent,
                    "bot_install_click",
                    INSTALL_URL,
                    { surface: "onboarding_wizard" },
                  );
                }}
              >
                Add Scout to Discord
              </a>
            </Button>
          </CardContent>
        </Card>

        {hasGuilds ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-scout-hover/30 p-3">
            <p className="text-sm">
              Scout is in {props.guildCount.toString()}{" "}
              {props.guildCount === 1 ? "server" : "servers"} you manage.
            </p>
            <Button onClick={props.onContinue}>Continue</Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
            <p className="text-sm text-scout-subtle">
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
