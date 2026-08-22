import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@scout-for-lol/design-system/components/card";
import { track } from "#src/lib/analytics.ts";
import {
  installCompletedEventProps,
  installContinueTarget,
  installLandingCopy,
  installLandingResult,
  type InstallLandingResult,
} from "#src/lib/install-landing-state.ts";
import { useTRPC } from "#src/lib/trpc.ts";

/**
 * Landing page Discord redirects to after the user adds the bot (the
 * registered `/app/installed` redirect URI). Discord echoes back the
 * single-use `state` token minted by /api/discord/install plus the chosen
 * `guild_id`; posting them to installAttribution.complete is what joins this
 * browser session to the new `GuildInstall` (marketing → install
 * attribution).
 *
 * Server-side token validation replaces the old sessionStorage nonce check: a
 * hand-crafted `/installed?guild_id=…` link has no valid unconsumed token, so
 * it gets the neutral "Finish setup" copy, never the install confirmation.
 * Copy, deep link, and the analytics event all come from the pure decisions
 * in `install-landing-state.ts` over the mutation's server-echoed response.
 */
export function InstallLanding() {
  const [params] = useSearchParams();
  const trpc = useTRPC();
  const completeMutation = useMutation(
    trpc.installAttribution.complete.mutationOptions(),
  );
  const completeRef = useRef(completeMutation.mutateAsync);
  completeRef.current = completeMutation.mutateAsync;
  const [result, setResult] = useState<InstallLandingResult | null>(null);
  // Single-use consume: the token burns on first post, so React StrictMode's
  // double effect (or a re-render) must not fire the mutation twice.
  const firedRef = useRef(false);

  const state = params.get("state");
  const guildIdParam = DiscordGuildIdSchema.safeParse(params.get("guild_id"));
  const guildId = guildIdParam.success ? guildIdParam.data : undefined;

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    if (state === null || state.length < 32) {
      setResult({ outcome: "invalid", guildId: null });
      return;
    }
    void (async () => {
      try {
        const response = await completeRef.current({
          state,
          ...(guildId === undefined ? {} : { guildId }),
        });
        const eventProps = installCompletedEventProps(response);
        if (eventProps !== null) {
          track("bot_install_completed", eventProps);
        }
        setResult(installLandingResult(response));
      } catch {
        // Attribution is best-effort; a failed post still leaves the user a
        // way forward into setup.
        setResult({ outcome: "invalid", guildId: null });
      }
    })();
  }, [guildId, state]);

  const copy = installLandingCopy(result);
  const continueTo = installContinueTarget(result);

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-12">
      <Card>
        <CardHeader>
          <h1 className="scout-card__title">{copy.title}</h1>
          <CardDescription>{copy.description}</CardDescription>
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
