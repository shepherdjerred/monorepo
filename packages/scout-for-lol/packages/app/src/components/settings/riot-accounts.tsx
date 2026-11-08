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
    <section className="space-y-6" aria-labelledby="league-accounts-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="league-accounts-heading" className="text-xl font-semibold">
          League accounts
        </h2>
        <Button onClick={props.onLink} disabled={!canLink || props.linking}>
          {props.linking ? "Opening Riot…" : "Link Riot account"}
        </Button>
      </div>
      <p className="text-scout-subtle">
        Verify your League accounts by signing in with Riot. You can then choose
        whether each account triggers automatic game-start and game-end posts in
        any Scout server.
      </p>
      {!canLink && (
        <p className="text-sm text-scout-subtle">
          New Riot account links are not available yet. Existing notification
          settings still work.
        </p>
      )}
      {props.notice !== null && (
        <p role="status" className="text-sm">
          {props.notice}
        </p>
      )}
      {props.error !== null && (
        <p role="alert" className="text-sm text-scout-danger">
          {props.error}
        </p>
      )}
      {props.data.accounts.length === 0 ? (
        <div className="rounded-lg border border-scout-border p-6">
          <p className="font-medium">No verified League accounts yet</p>
          <p className="mt-2 text-sm text-scout-subtle">
            Link an account to manage its match notifications. You can link more
            than one account.
          </p>
        </div>
      ) : (
        props.data.accounts.map((account) => (
          <div
            key={account.puuid}
            className="flex flex-wrap items-center justify-between gap-5 rounded-lg border border-scout-border bg-scout-surface p-6"
          >
            <div className="min-w-0 flex-1 space-y-2">
              <h3 className="break-words text-lg font-semibold">
                {account.gameName}#{account.tagLine}
              </h3>
              <p className="text-xs text-scout-subtle">Verified with Riot</p>
              <label
                htmlFor={`notifications-${account.puuid}`}
                className="block text-sm font-medium"
              >
                Match notifications
              </label>
              <p className="text-sm text-scout-subtle">
                {account.matchNotificationsEnabled
                  ? "This account can trigger game-start and game-end posts in every Scout server that follows it."
                  : "This account will not trigger game-start or game-end posts in any Scout server."}
              </p>
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
          </div>
        ))
      )}
      <div className="space-y-2 text-sm text-scout-subtle">
        <p>
          Turning notifications off keeps tracking, profiles, statistics, and
          match history available. If another player triggers a shared report,
          your account can still appear with its normal name and Discord
          mentions.
        </p>
        <p>
          Already posted messages stay in Discord. A notification already being
          sent may still arrive. Turning notifications back on does not request
          reports for missed games.
        </p>
        <p>
          Account linked to a different Discord login?{" "}
          <Link className="text-scout-accent underline" to="/feedback">
            Contact support
          </Link>{" "}
          to resolve the existing link.
        </p>
      </div>
    </section>
  );
}
