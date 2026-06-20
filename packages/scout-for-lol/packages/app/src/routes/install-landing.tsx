import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "#src/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#src/components/ui/card.tsx";
import { consumeInstallState } from "#src/lib/discord-invite.ts";

/**
 * Landing page Discord redirects to after the user adds the bot (the
 * registered `/app/installed` redirect URI). The wizard re-detects the new
 * guild on return, so this just confirms success and routes back into setup.
 *
 * We verify the `state` nonce Discord echoes back against the one we minted
 * before the install (see `discordInviteUrl`). A hand-crafted
 * `/installed?guild_id=…` link has no matching nonce, so we don't show the
 * misleading "Scout added 🎉 for <guild>" confirmation for an install the
 * user never initiated.
 */
export function InstallLanding() {
  const [params] = useSearchParams();
  // Single-use consume: run exactly once via the state initializer so a
  // re-render doesn't re-read the already-cleared nonce.
  const [stateVerified] = useState(() =>
    consumeInstallState(params.get("state")),
  );
  const guildId = stateVerified ? params.get("guild_id") : null;
  // Carry the freshly-installed guild into the wizard so "Continue setup"
  // skips the install step and lands on step 2 (concepts).
  const continueTo =
    guildId === null
      ? "/welcome"
      : `/welcome?guild=${encodeURIComponent(guildId)}`;

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>
            {stateVerified ? "Scout added 🎉" : "Finish setup"}
          </CardTitle>
          <CardDescription>
            {stateVerified
              ? guildId === null
                ? "Scout was added to your server. Let's finish setting it up."
                : "Scout is now in your server. Let's finish setting it up."
              : "Pick up where you left off and finish setting up Scout."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to={continueTo}>Continue setup</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/">Go to dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
