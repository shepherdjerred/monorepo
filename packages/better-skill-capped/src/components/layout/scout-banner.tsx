import React from "react";
import { ExternalLink } from "lucide-react";
import { Card, CardContent } from "#components/ui/card";

/**
 * Cross-promo for Scout (also by Jerred). Deliberately kept through the
 * rewrite; upgraded from a plain Bulma notification to a proper card.
 */
export function ScoutBanner(): React.ReactElement {
  return (
    <Card className="mb-4 border-amber-300/60 bg-amber-50 py-4 dark:border-primary/40 dark:bg-primary/10 dark:text-primary-foreground">
      <CardContent className="flex items-center gap-3 px-4 text-sm">
        <span aria-hidden className="text-xl">
          🔭
        </span>
        <p>
          Never miss a game from your friends. Try{" "}
          <a
            href="https://scout-for-lol.com/"
            className="font-semibold underline underline-offset-2"
          >
            Scout
            <ExternalLink className="ml-0.5 inline size-3.5 align-text-top" />
          </a>{" "}
          for Discord alerts, detailed post-match reports, and custom
          competitions with daily leaderboards.
        </p>
      </CardContent>
    </Card>
  );
}
