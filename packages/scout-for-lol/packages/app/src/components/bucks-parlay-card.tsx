import { formatInteger } from "@scout-for-lol/data";
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

export type ParlayCardMarket = {
  title: string;
  subtitle: string;
  legs: string[];
  qualification?: string | undefined;
  yesOdds: string;
  noOdds: string;
  yourPosition: { side: string; stake: number } | null;
  /** Named positions (match parlays) — weekly parlays pass aggregates instead. */
  positions?: { discordId: string; side: string; stake: number }[];
  aggregate?: { bettorCount: number; totalStaked: number };
};

/**
 * A fixed-odds YES/NO parlay market — match-scoped or weekly. Odds arrive
 * preformatted from the server so the rounding rules live in exactly one
 * place; weekly markets show aggregate positions only, matching the Discord
 * publication's privacy shape.
 */
export function BucksParlayCard(props: {
  idPrefix: string;
  market: ParlayCardMarket;
  remainingMs: number;
  balance: number | null;
  /** False for a signed-in member with no tracked player in this server —
   * every submission would return `not_eligible`, so the form stays hidden. */
  canBet: boolean;
  nameOf: (discordId: string) => string;
  pending: boolean;
  serverError: string | null;
  onPlace: (submission: BucksBetSubmission) => void;
}) {
  const closed = props.remainingMs <= 0;
  const market = props.market;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span>{market.title}</span>
          <BucksCountdown remainingMs={props.remainingMs} />
        </CardTitle>
        <CardDescription>{market.subtitle}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ol className="list-decimal space-y-0.5 pl-5 text-sm">
          {market.legs.map((leg) => (
            <li key={leg}>{leg}</li>
          ))}
        </ol>
        {market.qualification === undefined ? null : (
          <p className="text-scout-subtle text-sm">{market.qualification}</p>
        )}
        <p className="text-sm font-medium">
          YES {market.yesOdds}× · NO {market.noOdds}×
        </p>
        {market.positions !== undefined && market.positions.length > 0 ? (
          <ul className="space-y-0.5 text-sm">
            {market.positions.map((position) => (
              <li key={position.discordId}>
                {props.nameOf(position.discordId)} — {position.side}{" "}
                {formatInteger(position.stake)} BB
              </li>
            ))}
          </ul>
        ) : null}
        {market.aggregate === undefined ? null : (
          <p className="text-scout-subtle text-sm">
            {formatInteger(market.aggregate.bettorCount)} bettor
            {market.aggregate.bettorCount === 1 ? "" : "s"} ·{" "}
            {formatInteger(market.aggregate.totalStaked)} BB staked
          </p>
        )}
        {market.yourPosition === null ? (
          closed ? null : props.canBet ? (
            <BucksBetForm
              idPrefix={props.idPrefix}
              sideOptions={[
                { value: "YES", label: "YES" },
                { value: "NO", label: "NO" },
              ]}
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
          <div className="space-y-2">
            <p className="text-sm">
              Your bet: {market.yourPosition.side}{" "}
              {formatInteger(market.yourPosition.stake)} BB
            </p>
            {closed || !props.canBet ? null : (
              <BucksBetForm
                idPrefix={`${props.idPrefix}-topup`}
                sideOptions={[
                  {
                    value: market.yourPosition.side,
                    label: market.yourPosition.side,
                  },
                ]}
                balance={props.balance ?? Number.MAX_SAFE_INTEGER}
                pending={props.pending}
                serverError={props.serverError}
                submitLabel="Add to bet"
                onSubmit={props.onPlace}
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
