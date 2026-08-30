import { formatInteger } from "@scout-for-lol/data";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import {
  BucksBetForm,
  type BucksBetSubmission,
} from "#src/components/bucks-bet-form.tsx";
import { BucksCountdown } from "#src/components/bucks-countdown.tsx";

export type OutcomeMarketSideView = {
  teamId: number;
  label: string;
  trackedPlayers: string[];
  totalStake: number;
  betCount: number;
  positions: { discordId: string; stake: number }[];
};

export type OutcomeMarketView = {
  matchId: string;
  sides: OutcomeMarketSideView[];
  yourPosition: {
    teamId: number;
    offeredStake: number;
    cancellationFee: number;
  } | null;
};

function SidePanel(props: {
  side: OutcomeMarketSideView;
  nameOf: (discordId: string) => string;
}) {
  return (
    <div className="min-w-48 flex-1">
      <p className="font-semibold">
        {props.side.label}
        {props.side.trackedPlayers.length > 0 ? (
          <span className="text-scout-subtle ml-2 text-sm font-normal">
            {props.side.trackedPlayers.join(", ")}
          </span>
        ) : null}
      </p>
      <p className="text-scout-subtle text-sm">
        {formatInteger(props.side.totalStake)} BB across{" "}
        {formatInteger(props.side.betCount)} bet
        {props.side.betCount === 1 ? "" : "s"}
      </p>
      <ul className="mt-1 space-y-0.5 text-sm">
        {props.side.positions.map((position) => (
          <li key={position.discordId}>
            {props.nameOf(position.discordId)} — {formatInteger(position.stake)}{" "}
            BB
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * One open outcome market: the public side digest (named positions, exactly as
 * the Discord market message shows them), a countdown, and either the bet form
 * or the caller's own position with a cancel affordance.
 */
export function BucksMarketCard(props: {
  market: OutcomeMarketView;
  remainingMs: number;
  balance: number | null;
  /** False for a signed-in member with no tracked player in this server —
   * every submission would return `not_eligible`, so the form stays hidden. */
  canBet: boolean;
  nameOf: (discordId: string) => string;
  pending: boolean;
  serverError: string | null;
  onPlace: (submission: BucksBetSubmission) => void;
  onCancelRequest: () => void;
}) {
  const closed = props.remainingMs <= 0;
  const sideLabel = (teamId: number) =>
    props.market.sides.find((side) => side.teamId === teamId)?.label ??
    teamId.toString();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>Match outcome</span>
          <BucksCountdown remainingMs={props.remainingMs} />
        </CardTitle>
        <CardDescription>{props.market.matchId}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-6">
          {props.market.sides.map((side) => (
            <SidePanel key={side.teamId} side={side} nameOf={props.nameOf} />
          ))}
        </div>
        {props.market.yourPosition === null ? (
          closed ? null : props.canBet ? (
            <BucksBetForm
              idPrefix={`bet-${props.market.matchId}`}
              sideOptions={props.market.sides.map((side) => ({
                value: side.teamId.toString(),
                label: side.label,
              }))}
              balance={props.balance ?? Number.MAX_SAFE_INTEGER}
              pending={props.pending}
              serverError={props.serverError}
              onSubmit={props.onPlace}
            />
          ) : (
            <p className="text-scout-subtle text-sm">
              Only players tracked in this server can bet.
            </p>
          )
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm">
              Your offer:{" "}
              {formatInteger(props.market.yourPosition.offeredStake)} BB on{" "}
              {sideLabel(props.market.yourPosition.teamId)}
            </p>
            {closed ? null : (
              <>
                {props.canBet ? (
                  <BucksBetForm
                    idPrefix={`topup-${props.market.matchId}`}
                    sideOptions={[
                      {
                        value: props.market.yourPosition.teamId.toString(),
                        label: sideLabel(props.market.yourPosition.teamId),
                      },
                    ]}
                    balance={props.balance ?? Number.MAX_SAFE_INTEGER}
                    pending={props.pending}
                    serverError={props.serverError}
                    submitLabel="Add to bet"
                    onSubmit={props.onPlace}
                  />
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={props.onCancelRequest}
                >
                  Cancel bet
                </Button>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
