import { formatInteger } from "@scout-for-lol/data";
import { Badge } from "@scout-for-lol/design-system/components/badge";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";

export type BucksPendingPositionView =
  | {
      marketType: "outcome";
      matchId: string;
      gameAlias: string;
      sideLabel: string;
      offeredStake: number;
      matchedStake: number | null;
      poolState: string;
      cancellationFee: number | null;
    }
  | {
      marketType: "parlay";
      matchId: string;
      subjectAlias: string;
      side: string;
      stake: number;
      poolState: string;
    };

function positionKey(position: BucksPendingPositionView): string {
  return `${position.marketType}:${position.matchId}`;
}

/** The caller's own pending positions, as `/bb balance` reports them. */
export function BucksPendingPositions(props: {
  positions: BucksPendingPositionView[];
  onCancelOutcome: (matchId: string) => void;
}) {
  if (props.positions.length === 0) {
    return null;
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pending positions</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {props.positions.map((position) => (
            <li
              key={positionKey(position)}
              className="flex flex-wrap items-center gap-2 text-sm"
            >
              {position.marketType === "outcome" ? (
                <>
                  <span>
                    {position.gameAlias}&apos;s game — {position.sideLabel},{" "}
                    {formatInteger(position.offeredStake)} BB offered
                    {position.matchedStake === null
                      ? ""
                      : `, ${formatInteger(position.matchedStake)} BB matched`}
                  </span>
                  <Badge variant="outline">{position.poolState}</Badge>
                  {position.poolState === "open" &&
                  position.cancellationFee !== null ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        props.onCancelOutcome(position.matchId);
                      }}
                    >
                      Cancel
                    </Button>
                  ) : null}
                </>
              ) : (
                <>
                  <span>
                    {position.subjectAlias} — {position.side},{" "}
                    {formatInteger(position.stake)} BB
                  </span>
                  <Badge variant="outline">{position.poolState}</Badge>
                </>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
