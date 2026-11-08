import { Link } from "react-router";
import { Button } from "@scout-for-lol/design-system/components/button";
import { Switch } from "@scout-for-lol/design-system/components/forms/switch";
import type { RouterOutputs } from "#src/lib/query/trpc.ts";

export type RiotAccountSettingsData = RouterOutputs["riotAccount"]["list"];
export type VerifiedRiotAccount = RiotAccountSettingsData["accounts"][number];

export function RiotAccountsSettings(props: {
  data: RiotAccountSettingsData;
  linking: boolean;
  savingPuuid: string | null;
  notice: string | null;
  error: string | null;
  onLink: () => void;
  onSetEnabled: (account: VerifiedRiotAccount, enabled: boolean) => void;
}) {
  const canLink = props.data.linkingEnabled && props.data.linkingConfigured;
  return (
    <section className="space-y-5" aria-labelledby="league-accounts-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="league-accounts-heading" className="text-lg font-semibold">
          League accounts
        </h2>
        <Button
          variant="outline"
          size="sm"
          onClick={props.onLink}
          disabled={!canLink || props.linking}
        >
          {props.linking ? "Connecting…" : "Link Riot account"}
        </Button>
      </div>
      <p className="text-sm text-scout-subtle">
        Game-start and game-end posts across all Scout servers.
      </p>
      {!canLink && (
        <p className="text-sm text-scout-subtle">
          Account linking is currently unavailable.
        </p>
      )}
      {props.notice !== null && (
        <p role="status" className="text-sm">
          {props.notice}
        </p>
      )}
      {props.error !== null && (
        <p role="alert" className="text-sm text-scout-danger">
          {props.error}{" "}
          <Link className="underline" to="/feedback">
            Contact support
          </Link>
        </p>
      )}
      {props.data.accounts.length === 0 ? (
        <div className="rounded-lg border border-scout-border bg-scout-surface px-5 py-6">
          <p className="text-sm font-medium">No linked accounts</p>
          <p className="mt-2 text-sm text-scout-subtle">
            Link your Riot account to manage match notifications.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-scout-border rounded-lg border border-scout-border bg-scout-surface">
          {props.data.accounts.map((account) => (
            <li
              key={account.puuid}
              className="flex items-center justify-between gap-4 px-5 py-4"
            >
              <div className="min-w-0 space-y-1">
                <h3 className="break-words text-sm font-medium">
                  {account.gameName}#{account.tagLine}
                </h3>
                <label
                  htmlFor={`notifications-${account.puuid}`}
                  className="block text-xs text-scout-subtle"
                >
                  Match notifications
                </label>
              </div>
              <Switch
                id={`notifications-${account.puuid}`}
                aria-label={`Match notifications for ${account.gameName}#${account.tagLine}`}
                checked={account.matchNotificationsEnabled}
                disabled={props.savingPuuid !== null}
                onCheckedChange={(enabled) => {
                  props.onSetEnabled(account, enabled);
                }}
              />
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-scout-subtle">
        Tracking, stats, and history continue. Shared reports may still include
        your name and Discord mentions.
      </p>
      <details className="text-sm text-scout-subtle">
        <summary className="w-fit cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-scout-focus">
          How notifications work
        </summary>
        <div className="mt-3 space-y-2">
          <p>
            Turning notifications off stops posts triggered by this account
            across all Scout servers.
          </p>
          <p>
            Existing posts stay in Discord. Posts already being sent may still
            arrive. Turning notifications back on won’t post missed games.
          </p>
          <p>
            <Link className="underline" to="/feedback">
              Contact support
            </Link>{" "}
            for help with a linked account.
          </p>
        </div>
      </details>
    </section>
  );
}
