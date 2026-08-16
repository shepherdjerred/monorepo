import React from "react";
import { ExternalLink } from "lucide-react";
import { Card, CardContent } from "#components/ui/card";

/**
 * Cross-promo for Scout (also by Jerred). Deliberately kept through the
 * rewrite; upgraded from a plain Bulma notification to a proper card.
 */
export function ScoutBanner(): React.ReactElement {
  return (
    <Card className="mb-4 border-amber-300/60 bg-amber-50 py-4 dark:border-amber-400/20 dark:bg-amber-950/30">
      <CardContent className="flex items-center gap-3 px-4 text-sm">
        <span aria-hidden className="text-xl">
          🔭
        </span>
        <p>
          Check out{" "}
          <a
            href="https://scout-for-lol.com/"
            className="font-semibold underline underline-offset-2"
          >
            Scout
            <ExternalLink className="ml-0.5 inline size-3.5 align-text-top" />
          </a>{" "}
          — a Discord bot that notifies you when friends finish League matches,
          with detailed post-match reports.
        </p>
      </CardContent>
    </Card>
  );
}
